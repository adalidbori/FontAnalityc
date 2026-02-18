const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./db');

const app = express();
const port = 3001;

const ENDPOINT = process.env.ENDPOINT;
const FRONT_API_KEY = process.env.FRONT_API_KEY;
const FRONT_API_KEY_INDIVIDUALS = process.env.FRONT_API_KEY_INDIVIDUALS;

// Cache directory
const CACHE_DIR = path.join(__dirname, 'cache');

// Asegurar que existe el directorio de cache
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Inicializar base de datos al arrancar
db.initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

// Middleware to parse JSON bodies
app.use(express.json());

// Configurar la carpeta 'public' como estática
app.use(express.static(path.join(__dirname, 'public')));

// Ruta base para servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Utility function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Endpoint para obtener datos cacheados
 * GET /getCachedData?department=Concierge&range=thisWeek
 */
app.get('/getCachedData', (req, res) => {
  try {
    const { department, range } = req.query;

    if (!department || !range) {
      return res.status(400).json({
        error: 'Missing parameters: department and range are required'
      });
    }

    const validRanges = ['yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];
    if (!validRanges.includes(range)) {
      return res.status(400).json({
        error: `Invalid range. Valid options: ${validRanges.join(', ')}`
      });
    }

    const filename = `${department.toLowerCase().replace(/\s+/g, '-')}_${range}.json`;
    const filepath = path.join(CACHE_DIR, filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        error: 'Cache not found',
        message: 'No cached data available for this department/range combination. Run the cache scheduler first.'
      });
    }

    const cachedData = JSON.parse(fs.readFileSync(filepath, 'utf8'));

    // Verificar antigüedad del cache
    const generatedAt = new Date(cachedData.generatedAt);
    const ageMinutes = Math.floor((Date.now() - generatedAt.getTime()) / (1000 * 60));

    res.status(200).json({
      ...cachedData,
      cacheAge: `${ageMinutes} minutes ago`,
      fromCache: true
    });

  } catch (error) {
    console.error('Error reading cache:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Endpoint para listar caches disponibles
 * GET /listCaches
 */
app.get('/listCaches', (req, res) => {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      return res.status(200).json({ caches: [] });
    }

    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    const caches = files.map(filename => {
      const filepath = path.join(CACHE_DIR, filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      return {
        filename,
        department: data.department,
        range: data.range,
        rangeLabel: data.rangeLabel,
        generatedAt: data.generatedAt,
        totalRecords: data.totalRecords
      };
    });

    res.status(200).json({ caches });
  } catch (error) {
    console.error('Error listing caches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/getData', async (req, res) => {
  try {
    const { timestampStart, timestampEnd, registros } = req.body;

    // Validate input
    if (!timestampStart || !timestampEnd || !Array.isArray(registros)) {
      console.error('Validation failed:', { timestampStart, timestampEnd, registros });
      return res.status(400).json({
        error: 'Invalid input: timestampStart, timestampEnd, and registros (array) are required',
      });
    }

    console.log('Received data:', { timestampStart, timestampEnd, registros });

    // Store API responses
    const apiResponses = [];

    // Iterate over registros with a 2-second delay
    for (const [index, record] of registros.entries()) {
      console.log(`Processing record ${index + 1} at ${new Date().toISOString()}:`, record);

      const requestBody = {
        filters: {
          channel_ids: [record.code],
          teammate_ids: [record.id],
        },
        start: timestampStart,
        end: timestampEnd,
        timezone: 'America/New_York',
        metrics: [
          'num_messages_received',
          'num_messages_sent',
          'avg_response_time',
        ],
      };

      // Call FRONT API with retries
      const result = await callFrontApi(requestBody, index + 1, false);
      apiResponses.push({
        recordIndex: index + 1,
        record,
        ...result,
      });

      // Wait 2 seconds before the next record (except after the last one)
      if (index < registros.length - 1) {
        console.log(`Waiting 2 seconds before processing next record...`);
        await delay(3000); // Corrected to 2 seconds
      }
    }

    // Send success response
    const response = {
      message: 'Records processed successfully',
      totalRecords: registros.length,
      timestampStart,
      timestampEnd,
      apiResponses,
    };
    console.log('Sending response:', response);
    res.status(200).json(response);
  } catch (error) {
    console.error('Error processing /getData:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/getDataIndividuals', async (req, res) => {
  try {
    const { timestampStart, timestampEnd, inboxes } = req.body;
    // Validación de entrada
    if (!timestampStart || !timestampEnd || !Array.isArray(inboxes)) {
      console.error('Validation failed:', { timestampStart, timestampEnd, inboxes });
      return res.status(400).json({
        error: 'Invalid input: timestampStart, timestampEnd, and registros (array) are required'
      });
    }

    const apiResponses = [];

    for (const [index, record] of inboxes.entries()) {
      console.log(`Processing record ${index + 1} at ${new Date().toISOString()}:`, record);
      const requestBody = {
        filters: {
          teammate_ids: [record.id],
        },
        start: timestampStart,
        end: timestampEnd,
        timezone: 'America/New_York',
        metrics: [
          'num_messages_received',
          'num_messages_sent',
          'avg_response_time',
        ],
      };

      // Llamar a la API con reintentos
      const result = await callFrontApi(requestBody, index + 1, true);
      apiResponses.push({
        recordIndex: index + 1,
        record,
        ...result,
      });

      // Espera antes de procesar el siguiente registro (si no es el último)
      if (index < inboxes.length - 1) {
        console.log(`Waiting 2 seconds before processing next record...`);
        await delay(3000); // Nota: Comentario corregido, aquí espera 5 segundos
      }
    }

    // Enviar la respuesta una sola vez, después de procesar todos los registros
    const response = {
      message: 'Records processed successfully',
      totalRecords: inboxes.length,
      timestampStart,
      timestampEnd,
      apiResponses,
    };
    console.log('Sending response:', response);
    return res.status(200).json(response);

  } catch (error) {
    console.error('Error processing /getDataIndividuals:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// Function to call FRONT API with retries
async function callFrontApi(requestBody, recordIndex, isIndividual) {
  const maxRetries = 10;
  let retries = 0;
  const API_KEY_TO_USE = (isIndividual) ? FRONT_API_KEY_INDIVIDUALS : FRONT_API_KEY;
  while (retries < maxRetries) {
    try {
      console.log(`Attempt ${retries + 1} for record ${recordIndex}:`, requestBody);
      const frontResponse = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: API_KEY_TO_USE,
        },
        body: JSON.stringify(requestBody),
      });

      if (!frontResponse.ok) {
        const errorData = await frontResponse.json().catch(() => ({}));
        console.error(`Error calling FRONT API for record ${recordIndex} (attempt ${retries + 1}):`, errorData);
        throw new Error(errorData.message || 'FRONT API error');
      }

      const responseData = await frontResponse.json();
      console.log(`FRONT API response for record ${recordIndex} (attempt ${retries + 1}):`, responseData);

      if (responseData.status === 'done') {
        return { apiData: responseData };
      }

      // Status is not 'done', retry after 2 seconds
      console.log(`Record ${recordIndex} status is "${responseData.status}", retrying after 2 seconds...`);
      retries++;
      if (retries < maxRetries) {
        await delay(3000); // 2 seconds between retries
      }
    } catch (error) {
      console.error(`Error calling FRONT API for record ${recordIndex} (attempt ${retries + 1}):`, error.message);
      return { error: error.message }; // Return error immediately on failure
    }
  }

  // Max retries reached
  console.error(`Max retries (${maxRetries}) reached for record ${recordIndex}, status not 'done'`);
  return { error: `Max retries reached, status not 'done'` };
}

// ==========================================
// API ENDPOINTS - INBOXES
// ==========================================

// GET all inboxes
app.get('/api/inboxes', async (req, res) => {
  try {
    const inboxes = await db.getAllInboxes();
    res.json(inboxes);
  } catch (error) {
    console.error('Error getting inboxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single inbox
app.get('/api/inboxes/:id', async (req, res) => {
  try {
    const inbox = await db.getInboxById(parseInt(req.params.id));
    if (!inbox) {
      return res.status(404).json({ error: 'Inbox not found' });
    }
    res.json(inbox);
  } catch (error) {
    console.error('Error getting inbox:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE inbox
app.post('/api/inboxes', async (req, res) => {
  try {
    const { code, name, description } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'Code and name are required' });
    }
    const inbox = await db.createInbox(code, name, description);
    res.status(201).json(inbox);
  } catch (error) {
    console.error('Error creating inbox:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Inbox with this code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE inbox
app.put('/api/inboxes/:id', async (req, res) => {
  try {
    const { code, name, description } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'Code and name are required' });
    }
    const inbox = await db.updateInbox(parseInt(req.params.id), code, name, description);
    if (!inbox) {
      return res.status(404).json({ error: 'Inbox not found' });
    }
    res.json(inbox);
  } catch (error) {
    console.error('Error updating inbox:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE inbox
app.delete('/api/inboxes/:id', async (req, res) => {
  try {
    const inbox = await db.deleteInbox(parseInt(req.params.id));
    if (!inbox) {
      return res.status(404).json({ error: 'Inbox not found' });
    }
    res.json({ message: 'Inbox deleted', inbox });
  } catch (error) {
    console.error('Error deleting inbox:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// API ENDPOINTS - USERS
// ==========================================

// GET all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single user
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await db.getUserById(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE user
app.post('/api/users', async (req, res) => {
  try {
    const { teammate_id, email, name, is_individual } = req.body;
    if (!teammate_id || !email || !name) {
      return res.status(400).json({ error: 'teammate_id, email and name are required' });
    }
    const user = await db.createUser(teammate_id, email, name, is_individual || false);
    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'User with this teammate_id already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE user
app.put('/api/users/:id', async (req, res) => {
  try {
    const { teammate_id, email, name, is_individual } = req.body;
    if (!teammate_id || !email || !name) {
      return res.status(400).json({ error: 'teammate_id, email and name are required' });
    }
    const user = await db.updateUser(parseInt(req.params.id), teammate_id, email, name, is_individual);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const user = await db.deleteUser(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted', user });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// API ENDPOINTS - USER-INBOX ASSIGNMENTS
// ==========================================

// GET users by inbox
app.get('/api/inboxes/:id/users', async (req, res) => {
  try {
    const users = await db.getUsersByInbox(parseInt(req.params.id));
    res.json(users);
  } catch (error) {
    console.error('Error getting inbox users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ASSIGN user to inbox
app.post('/api/inboxes/:inboxId/users/:userId', async (req, res) => {
  try {
    const assignment = await db.assignUserToInbox(
      parseInt(req.params.userId),
      parseInt(req.params.inboxId)
    );
    if (!assignment) {
      return res.json({ message: 'Assignment already exists' });
    }
    res.status(201).json({ message: 'User assigned to inbox', assignment });
  } catch (error) {
    console.error('Error assigning user to inbox:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// REMOVE user from inbox
app.delete('/api/inboxes/:inboxId/users/:userId', async (req, res) => {
  try {
    const result = await db.removeUserFromInbox(
      parseInt(req.params.userId),
      parseInt(req.params.inboxId)
    );
    if (!result) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    res.json({ message: 'User removed from inbox' });
  } catch (error) {
    console.error('Error removing user from inbox:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// API ENDPOINTS - DATA FOR ANALYTICS (using DB)
// ==========================================

// GET users by inbox name (for analytics - replaces JSON file)
app.get('/api/analytics/inbox/:inboxName', async (req, res) => {
  try {
    const users = await db.getUsersByInboxName(req.params.inboxName);
    res.json(users);
  } catch (error) {
    console.error('Error getting inbox users for analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET individual users (for analytics - replaces JSON file)
app.get('/api/analytics/individuals', async (req, res) => {
  try {
    const users = await db.getIndividualUsers();
    res.json(users);
  } catch (error) {
    console.error('Error getting individual users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// FRONT API - TEAMMATES
// ==========================================

// GET all teammates from Front API
app.get('/api/front/teammates', async (req, res) => {
  try {
    const response = await fetch('https://api2.frontapp.com/teammates', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': FRONT_API_KEY_INDIVIDUALS
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error._error?.message || 'Failed to fetch teammates');
    }

    const data = await response.json();

    // Transform data to simpler format
    const teammates = data._results.map(t => ({
      id: t.id,
      email: t.email,
      name: `${t.first_name} ${t.last_name}`.trim(),
      first_name: t.first_name,
      last_name: t.last_name,
      is_available: t.is_available,
      is_admin: t.is_admin
    }));

    res.json(teammates);
  } catch (error) {
    console.error('Error fetching teammates from Front:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all channels (shared inboxes) from Front API
app.get('/api/front/channels', async (req, res) => {
  try {
    // Use FRONT_API_KEY (shared scope) to get shared channels
    const response = await fetch('https://api2.frontapp.com/channels', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': FRONT_API_KEY
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error._error?.message || 'Failed to fetch channels');
    }

    const data = await response.json();

    // Transform channels (all from shared API are public)
    const channels = data._results.map(c => ({
      id: c.id,
      name: c.name,
      address: c.address,
      type: c.type
    }));

    res.json(channels);
  } catch (error) {
    console.error('Error fetching channels from Front:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search teammate by email
app.get('/api/front/teammates/search', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required' });
    }

    const response = await fetch('https://api2.frontapp.com/teammates', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': FRONT_API_KEY_INDIVIDUALS
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch teammates');
    }

    const data = await response.json();

    // Find teammate by email (case insensitive)
    const teammate = data._results.find(
      t => t.email.toLowerCase() === email.toLowerCase()
    );

    if (!teammate) {
      return res.status(404).json({ error: 'Teammate not found' });
    }

    res.json({
      id: teammate.id,
      email: teammate.email,
      name: `${teammate.first_name} ${teammate.last_name}`.trim(),
      first_name: teammate.first_name,
      last_name: teammate.last_name
    });
  } catch (error) {
    console.error('Error searching teammate:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, '0.0.0.0', () => {
  console.log('Listening on http://10.25.0.8:3001');
});