/**
 * Cache Scheduler - Pre-calcula métricas para rangos predefinidos
 *
 * Rangos y frecuencia:
 * - Yesterday: diario (a las 6 AM)
 * - This Week: diario (a las 6 AM)
 * - Last Week: semanal (lunes a las 6 AM)
 * - This Month: diario (a las 6 AM)
 * - Last Month: mensual (día 1 a las 6 AM)
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ENDPOINT = process.env.ENDPOINT;
const FRONT_API_KEY = process.env.FRONT_API_KEY;
const db = require('./db');

// Rangos predefinidos
const RANGES = ['yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];

// Directorio de cache (configurable for Azure App Service)
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');

// Asegurar que existe el directorio de cache
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Utility function para delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calcula timestamps para cada rango
 */
function getDateRange(rangeName) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (rangeName) {
    case 'yesterday': {
      const yesterday = new Date(todayStart);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);
      return {
        start: Math.floor(yesterday.getTime() / 1000),
        end: Math.floor(yesterdayEnd.getTime() / 1000),
        label: 'Yesterday'
      };
    }

    case 'thisWeek': {
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Domingo
      return {
        start: Math.floor(weekStart.getTime() / 1000),
        end: Math.floor(now.getTime() / 1000),
        label: 'This Week'
      };
    }

    case 'lastWeek': {
      const lastWeekEnd = new Date(todayStart);
      lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay() - 1); // Sábado pasado
      lastWeekEnd.setHours(23, 59, 59, 999);
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setDate(lastWeekStart.getDate() - 6); // Domingo pasado
      lastWeekStart.setHours(0, 0, 0, 0);
      return {
        start: Math.floor(lastWeekStart.getTime() / 1000),
        end: Math.floor(lastWeekEnd.getTime() / 1000),
        label: 'Last Week'
      };
    }

    case 'thisMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: Math.floor(monthStart.getTime() / 1000),
        end: Math.floor(now.getTime() / 1000),
        label: 'This Month'
      };
    }

    case 'lastMonth': {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return {
        start: Math.floor(lastMonthStart.getTime() / 1000),
        end: Math.floor(lastMonthEnd.getTime() / 1000),
        label: 'Last Month'
      };
    }

    default:
      throw new Error(`Unknown range: ${rangeName}`);
  }
}

/**
 * Obtiene todos los departamentos (inboxes) desde la base de datos
 */
async function getDepartmentsFromDB() {
  try {
    const inboxes = await db.getAllInboxes();
    return inboxes.map(inbox => inbox.name);
  } catch (error) {
    console.error('Error getting departments from database:', error.message);
    return [];
  }
}

/**
 * Obtiene usuarios de un departamento desde la base de datos
 */
async function getUsersByDepartment(departmentName) {
  try {
    const users = await db.getUsersByInboxName(departmentName);
    return users;
  } catch (error) {
    console.error(`  Error getting users for ${departmentName}:`, error.message);
    return [];
  }
}

/**
 * Llama a la API de Front con reintentos
 */
async function callFrontApi(requestBody, recordIndex) {
  const maxRetries = 10;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': FRONT_API_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.status === 429) {
        const errorData = await response.json();
        const waitTime = parseInt(errorData._error?.message?.match(/\d+/)?.[0] || 3000);
        console.log(`  Rate limited. Waiting ${waitTime}ms...`);
        await delay(waitTime + 500);
        retries++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'done') {
        return { apiData: data };
      }

      // Status pending/running, retry
      retries++;
      if (retries < maxRetries) {
        await delay(2500);
      }
    } catch (error) {
      console.error(`  Error for record ${recordIndex}:`, error.message);
      return { error: error.message };
    }
  }

  return { error: 'Max retries reached' };
}

/**
 * Pre-calcula métricas para un departamento y rango
 */
async function precalculateDepartment(departmentName, rangeName) {
  const range = getDateRange(rangeName);
  const users = await getUsersByDepartment(departmentName);

  if (users.length === 0) {
    console.log(`  No users found for ${departmentName}`);
    return null;
  }

  console.log(`  Processing ${users.length} users for ${departmentName} - ${range.label}`);

  const apiResponses = [];

  for (const [index, user] of users.entries()) {
    console.log(`    [${index + 1}/${users.length}] ${user.name}`);

    const requestBody = {
      filters: {
        channel_ids: [user.code],
        teammate_ids: [user.id],
      },
      start: range.start,
      end: range.end,
      timezone: 'America/New_York',
      metrics: ['num_messages_received', 'num_messages_sent', 'avg_response_time'],
    };

    const result = await callFrontApi(requestBody, index + 1);
    apiResponses.push({
      recordIndex: index + 1,
      record: user,
      ...result,
    });

    // Delay entre llamadas
    if (index < users.length - 1) {
      await delay(2200);
    }
  }

  return {
    department: departmentName,
    range: rangeName,
    rangeLabel: range.label,
    timestampStart: range.start,
    timestampEnd: range.end,
    generatedAt: new Date().toISOString(),
    totalRecords: users.length,
    apiResponses,
  };
}

/**
 * Guarda resultados en cache
 */
function saveToCache(departmentName, rangeName, data) {
  const filename = `${departmentName.toLowerCase().replace(/\s+/g, '-')}_${rangeName}.json`;
  const filepath = path.join(CACHE_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  Saved to cache: ${filename}`);
}

/**
 * Lee datos del cache
 */
function readFromCache(departmentName, rangeName) {
  const filename = `${departmentName.toLowerCase().replace(/\s+/g, '-')}_${rangeName}.json`;
  const filepath = path.join(CACHE_DIR, filename);

  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }
  return null;
}

/**
 * Verifica si el cache tiene errores (datos corruptos)
 */
function hasCacheErrors(cachedData) {
  if (!cachedData || !cachedData.apiResponses) return true;

  // Check if any response has an error instead of apiData
  return cachedData.apiResponses.some(response => {
    return response.error || !response.apiData || !response.apiData.metrics;
  });
}

/**
 * Verifica si necesita actualizar según la frecuencia
 */
function needsUpdate(rangeName, cachedData) {
  if (!cachedData) return true;

  // Force update if cache has errors
  if (hasCacheErrors(cachedData)) {
    console.log(`  ⚠️  Cache has errors, forcing regeneration`);
    return true;
  }

  const generatedAt = new Date(cachedData.generatedAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const generatedDate = new Date(generatedAt.getFullYear(), generatedAt.getMonth(), generatedAt.getDate());

  switch (rangeName) {
    case 'yesterday':
    case 'thisWeek':
    case 'thisMonth':
      // Actualizar si no se generó hoy
      return generatedDate < today;

    case 'lastWeek':
      // Actualizar si es lunes y no se generó hoy
      if (now.getDay() === 1 && generatedDate < today) return true;
      // O si nunca se generó esta semana
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
      return generatedDate < thisWeekStart;

    case 'lastMonth':
      // Actualizar si es día 1 y no se generó hoy
      if (now.getDate() === 1 && generatedDate < today) return true;
      // O si nunca se generó este mes
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return generatedDate < thisMonthStart;

    default:
      return true;
  }
}

/**
 * Ejecuta el pre-cálculo completo
 */
async function runPrecalculation(forceAll = false) {
  console.log('========================================');
  console.log('Starting cache precalculation...');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // Obtener departamentos dinámicamente de la base de datos
  const departments = await getDepartmentsFromDB();

  if (departments.length === 0) {
    console.log('No departments found in database. Please add inboxes first.');
    return;
  }

  console.log(`Found ${departments.length} departments: ${departments.join(', ')}\n`);

  for (const department of departments) {
    console.log(`\n📁 Department: ${department}`);
    console.log('----------------------------------------');

    for (const rangeName of RANGES) {
      const cached = readFromCache(department, rangeName);

      if (!forceAll && !needsUpdate(rangeName, cached)) {
        console.log(`  ⏭️  ${rangeName}: Using cached data (generated ${cached.generatedAt})`);
        continue;
      }

      console.log(`  🔄 ${rangeName}: Fetching fresh data...`);

      try {
        const data = await precalculateDepartment(department, rangeName);
        if (data) {
          saveToCache(department, rangeName, data);
          console.log(`  ✅ ${rangeName}: Done`);
        }
      } catch (error) {
        console.error(`  ❌ ${rangeName}: Error - ${error.message}`);
      }

      // Delay entre rangos
      await delay(3000);
    }
  }

  console.log('\n========================================');
  console.log('Precalculation complete!');
  console.log('========================================\n');
}

/**
 * Programa la ejecución automática
 */
function scheduleJobs() {
  const checkInterval = 60 * 60 * 1000; // Revisar cada hora

  console.log('Scheduler started. Checking every hour...\n');

  // Ejecutar inmediatamente al iniciar
  runPrecalculation();

  // Luego verificar cada hora
  setInterval(() => {
    const now = new Date();
    // Ejecutar a las 6 AM
    if (now.getHours() === 6 && now.getMinutes() < 5) {
      console.log('Scheduled run triggered (6 AM)');
      runPrecalculation();
    }
  }, checkInterval);
}

// Exportar funciones para uso externo
module.exports = {
  getDateRange,
  readFromCache,
  runPrecalculation,
  scheduleJobs,
  getDepartmentsFromDB,
  RANGES,
};

// Si se ejecuta directamente
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--force')) {
    console.log('Force mode: Updating all caches...\n');
    runPrecalculation(true);
  } else if (args.includes('--schedule')) {
    scheduleJobs();
  } else {
    runPrecalculation();
  }
}
