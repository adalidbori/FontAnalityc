/**
 * Cache Scheduler - Pre-calcula métricas para rangos predefinidos (Multi-Tenant)
 *
 * Todos los rangos se actualizan diariamente a las 6 AM ET:
 * - Yesterday, This Week, Last Week, This Month, Last Month
 *
 * Iterates over all active tenants and precalculates per-tenant.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

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

// Timezone para cálculo de fechas (debe coincidir con el frontend y la API de Front)
const TIMEZONE = 'America/New_York';

/**
 * Obtiene los componentes de fecha actuales en America/New_York
 */
function getNowInTimezone() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
  const day = parseInt(parts.find(p => p.type === 'day').value);

  // Calcular día de la semana en ET
  const dayOfWeek = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  }).format(now).replace(/\./g, ''), 10) || ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(
    new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(now)
  );

  return { year, month, day, dayOfWeek };
}

/**
 * Convierte fecha/hora en America/New_York a Unix timestamp (segundos)
 */
function toUnixInTimezone(year, month, day, hours = 0, minutes = 0, seconds = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  // Parsear como UTC primero
  const utcDate = new Date(dateStr + 'Z');

  // Calcular el offset entre UTC y America/New_York
  const utcStr = utcDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = utcDate.toLocaleString('en-US', { timeZone: TIMEZONE });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();

  // Ajustar para obtener el momento exacto en UTC que corresponde a esa hora en ET
  return Math.floor((utcDate.getTime() + offsetMs) / 1000);
}

/**
 * Calcula timestamps para cada rango (en America/New_York)
 */
function getDateRange(rangeName) {
  const { year, month, day } = getNowInTimezone();

  switch (rangeName) {
    case 'yesterday': {
      const d = new Date(Date.UTC(year, month, day - 1));
      const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
      return {
        start: toUnixInTimezone(y, m, dd, 0, 0, 0),
        end: toUnixInTimezone(y, m, dd, 23, 59, 59),
        label: 'Yesterday'
      };
    }

    case 'thisWeek': {
      // Calcular día de la semana en ET (0=Sun)
      const nowET = new Date();
      const dowStr = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(nowET);
      const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(dowStr);
      const weekStart = new Date(Date.UTC(year, month, day - dow));
      return {
        start: toUnixInTimezone(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate(), 0, 0, 0),
        end: toUnixInTimezone(year, month, day, 0, 0, 0),
        label: 'This Week'
      };
    }

    case 'lastWeek': {
      const nowET = new Date();
      const dowStr = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(nowET);
      const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(dowStr);
      // Sábado pasado = hoy - dow - 1
      const satEnd = new Date(Date.UTC(year, month, day - dow - 1));
      // Domingo pasado = sábado - 6
      const sunStart = new Date(Date.UTC(satEnd.getUTCFullYear(), satEnd.getUTCMonth(), satEnd.getUTCDate() - 6));
      return {
        start: toUnixInTimezone(sunStart.getUTCFullYear(), sunStart.getUTCMonth(), sunStart.getUTCDate(), 0, 0, 0),
        end: toUnixInTimezone(satEnd.getUTCFullYear(), satEnd.getUTCMonth(), satEnd.getUTCDate(), 23, 59, 59),
        label: 'Last Week'
      };
    }

    case 'thisMonth': {
      return {
        start: toUnixInTimezone(year, month, 1, 0, 0, 0),
        end: toUnixInTimezone(year, month, day, 0, 0, 0),
        label: 'This Month'
      };
    }

    case 'lastMonth': {
      const lastMonthDate = new Date(Date.UTC(year, month - 1, 1));
      const lastDayOfLastMonth = new Date(Date.UTC(year, month, 0));
      return {
        start: toUnixInTimezone(lastMonthDate.getUTCFullYear(), lastMonthDate.getUTCMonth(), 1, 0, 0, 0),
        end: toUnixInTimezone(lastDayOfLastMonth.getUTCFullYear(), lastDayOfLastMonth.getUTCMonth(), lastDayOfLastMonth.getUTCDate(), 23, 59, 59),
        label: 'Last Month'
      };
    }

    default:
      throw new Error(`Unknown range: ${rangeName}`);
  }
}

/**
 * Obtiene todos los departamentos (inboxes) para un tenant desde la base de datos
 */
async function getDepartmentsForTenant(tenantId) {
  try {
    const inboxes = await db.getAllInboxes(tenantId);
    return inboxes.map(inbox => inbox.name);
  } catch (error) {
    console.error('Error getting departments from database:', error.message);
    return [];
  }
}

/**
 * Obtiene usuarios de un departamento desde la base de datos
 */
async function getUsersByDepartment(departmentName, tenantId) {
  try {
    const users = await db.getUsersByInboxName(departmentName, tenantId);
    return users;
  } catch (error) {
    console.error(`  Error getting users for ${departmentName}:`, error.message);
    return [];
  }
}

/**
 * Obtiene usuarios individuales desde la base de datos
 */
async function getIndividualUsersFromDB(tenantId) {
  try {
    const users = await db.getIndividualUsers(tenantId);
    return users;
  } catch (error) {
    console.error('Error getting individual users from database:', error.message);
    return [];
  }
}

/**
 * Llama a la API de Front con reintentos (parameterized API key + endpoint)
 */
async function callFrontApi(requestBody, recordIndex, apiKey, endpoint) {
  const maxRetries = 10;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': apiKey,
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
async function precalculateDepartment(departmentName, rangeName, apiKey, endpoint, tenantId) {
  const range = getDateRange(rangeName);
  const users = await getUsersByDepartment(departmentName, tenantId);

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

    const result = await callFrontApi(requestBody, index + 1, apiKey, endpoint);
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
 * Pre-calcula métricas para todos los usuarios individuales en un rango
 */
async function precalculateIndividuals(rangeName, apiKey, endpoint, tenantId) {
  const range = getDateRange(rangeName);
  const users = await getIndividualUsersFromDB(tenantId);

  if (users.length === 0) {
    console.log(`  No individual users found`);
    return null;
  }

  console.log(`  Processing ${users.length} individual users - ${range.label}`);

  const apiResponses = [];

  for (const [index, user] of users.entries()) {
    console.log(`    [${index + 1}/${users.length}] ${user.name}`);

    const requestBody = {
      filters: {
        teammate_ids: [user.id],
      },
      start: range.start,
      end: range.end,
      timezone: 'America/New_York',
      metrics: ['num_messages_received', 'num_messages_sent', 'avg_response_time'],
    };

    const result = await callFrontApi(requestBody, index + 1, apiKey, endpoint);
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
    department: 'individuals',
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
 * Guarda resultados en cache (prefixed with tenant slug)
 */
function saveToCache(tenantSlug, departmentName, rangeName, data) {
  const filename = `${tenantSlug}_${departmentName.toLowerCase().replace(/\s+/g, '-')}_${rangeName}.json`;
  const filepath = path.join(CACHE_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  Saved to cache: ${filename}`);
}

/**
 * Lee datos del cache (prefixed with tenant slug)
 */
function readFromCache(tenantSlug, departmentName, rangeName) {
  const filename = `${tenantSlug}_${departmentName.toLowerCase().replace(/\s+/g, '-')}_${rangeName}.json`;
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
    console.log(`  Cache has errors, forcing regeneration`);
    return true;
  }

  // Usar fecha/hora en America/New_York para determinar si necesita actualizar
  const { year, month, day } = getNowInTimezone();
  const todayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  // Fecha de generación en ET
  const generatedAt = new Date(cachedData.generatedAt);
  const genParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(generatedAt);
  const genYear = parseInt(genParts.find(p => p.type === 'year').value);
  const genMonth = parseInt(genParts.find(p => p.type === 'month').value);
  const genDay = parseInt(genParts.find(p => p.type === 'day').value);
  const genStr = `${genYear}-${String(genMonth).padStart(2,'0')}-${String(genDay).padStart(2,'0')}`;

  const generatedToday = genStr === todayStr;

  // Todos los rangos se actualizan diariamente: si no se generó hoy, actualizar
  return !generatedToday;
}

/**
 * Ejecuta el pre-cálculo completo para todos los tenants activos
 */
async function runPrecalculation(forceAll = false) {
  console.log('========================================');
  console.log('Starting cache precalculation...');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // Get all active tenants
  const tenants = await db.getActiveTenants();

  if (tenants.length === 0) {
    console.log('No active tenants found.');
    return;
  }

  console.log(`Found ${tenants.length} active tenant(s)\n`);

  for (const tenant of tenants) {
    console.log(`\n========== Tenant: ${tenant.name} (${tenant.slug}) ==========`);

    // Check if tenant has API keys configured
    const keys = await db.getTenantApiKeys(tenant.id);
    if (!keys || !keys.front_api_key) {
      console.log('  Skipping: No Front API key configured');
      continue;
    }

    const apiKey = keys.front_api_key;
    const apiKeyIndividuals = keys.front_api_key_individuals;
    const endpoint = keys.front_endpoint || 'https://api2.frontapp.com/analytics/reports';

    // Get departments for this tenant
    const departments = await getDepartmentsForTenant(tenant.id);

    if (departments.length === 0) {
      console.log('  No departments found for this tenant.');
    } else {
      console.log(`  Found ${departments.length} departments: ${departments.join(', ')}\n`);

      for (const department of departments) {
        console.log(`\n  Department: ${department}`);
        console.log('  ----------------------------------------');

        for (const rangeName of RANGES) {
          const cached = readFromCache(tenant.slug, department, rangeName);

          if (!forceAll && !needsUpdate(rangeName, cached)) {
            console.log(`    ${rangeName}: Using cached data (generated ${cached.generatedAt})`);
            continue;
          }

          console.log(`    ${rangeName}: Fetching fresh data...`);

          try {
            const data = await precalculateDepartment(department, rangeName, apiKey, endpoint, tenant.id);
            if (data) {
              saveToCache(tenant.slug, department, rangeName, data);
              console.log(`    ${rangeName}: Done`);
            }
          } catch (error) {
            console.error(`    ${rangeName}: Error - ${error.message}`);
          }

          // Delay entre rangos
          await delay(3000);
        }
      }
    }

    // Pre-calculate individual users (if individual API key is configured)
    if (apiKeyIndividuals) {
      console.log(`\n  Individual Users`);
      console.log('  ----------------------------------------');

      for (const rangeName of RANGES) {
        const cached = readFromCache(tenant.slug, 'individuals', rangeName);

        if (!forceAll && !needsUpdate(rangeName, cached)) {
          console.log(`    ${rangeName}: Using cached data (generated ${cached.generatedAt})`);
          continue;
        }

        console.log(`    ${rangeName}: Fetching fresh data...`);

        try {
          const data = await precalculateIndividuals(rangeName, apiKeyIndividuals, endpoint, tenant.id);
          if (data) {
            saveToCache(tenant.slug, 'individuals', rangeName, data);
            console.log(`    ${rangeName}: Done`);
          }
        } catch (error) {
          console.error(`    ${rangeName}: Error - ${error.message}`);
        }

        // Delay entre rangos
        await delay(3000);
      }
    } else {
      console.log('\n  Skipping individuals: No individual API key configured');
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
    // Usar hora en America/New_York (no UTC del servidor)
    const now = new Date();
    const hourET = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, hour: '2-digit', hour12: false
    }).format(now));
    const minuteET = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, minute: '2-digit'
    }).format(now));
    // Ejecutar a las 6 AM ET
    if (hourET === 6 && minuteET < 5) {
      console.log('Scheduled run triggered (6 AM ET)');
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
  getDepartmentsForTenant,
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
