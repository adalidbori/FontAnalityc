const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const { OIDCStrategy } = require('passport-azure-ad');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const db = require('./db');

const app = express();
const port = process.env.PORT || 3001;

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

// Middleware to parse JSON and form bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==========================================
// SESSION & PASSPORT CONFIGURATION
// ==========================================

// Session configuration with PostgreSQL store
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: {
    secure: isProduction, // true in production (requires HTTPS)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Azure AD OIDC Strategy Configuration
if (process.env.AZURE_CLIENT_ID && process.env.AZURE_TENANT_ID) {
  // Support Azure App Service's WEBSITE_HOSTNAME for dynamic redirect URI
  const redirectUrl = process.env.AZURE_REDIRECT_URI ||
    (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}/auth/callback` : 'http://localhost:3001/auth/callback');
  console.log('Azure AD Redirect URL:', redirectUrl);

  // Multi-tenant: use 'common' to accept any Azure AD tenant or personal Microsoft accounts
  // Use 'organizations' to only accept work/school accounts (no personal accounts)
  const tenantId = process.env.AZURE_MULTI_TENANT === 'true' ? 'common' : process.env.AZURE_TENANT_ID;

  const azureAdConfig = {
    identityMetadata: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
    clientID: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    responseType: 'code',
    responseMode: 'form_post',
    redirectUrl: redirectUrl,
    allowHttpForRedirectUrl: !isProduction, // Only allow HTTP in development
    scope: ['openid', 'profile', 'email'],
    passReqToCallback: false,
    loggingLevel: isProduction ? 'error' : 'warn',
    loggingNoPII: isProduction,
    validateIssuer: process.env.AZURE_MULTI_TENANT !== 'true', // Disable issuer validation for multi-tenant
    useCookieInsteadOfSession: true,
    cookieEncryptionKeys: [
      { key: process.env.SESSION_SECRET.substring(0, 32), iv: process.env.SESSION_SECRET.substring(32, 44) || '123456789012' }
    ],
    cookieSameSite: false, // Must be false for OAuth redirects to work
    nonceLifetime: 600, // 10 minutes
    nonceMaxAmount: 5
  };

  passport.use(new OIDCStrategy(azureAdConfig,
    async (iss, sub, profile, accessToken, refreshToken, done) => {
      try {
        const email = profile._json?.email || profile._json?.preferred_username || profile.upn;
        const name = profile.displayName || `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() || email;
        const azureOid = profile.oid;

        if (!email) {
          console.error('Azure AD: No email found in profile');
          return done(null, false, { message: 'NO_EMAIL' });
        }

        // Check if user exists in system_users table
        let systemUser = await db.getSystemUserByEmail(email);

        if (!systemUser) {
          console.log('Azure AD: Access denied for:', email);
          return done(null, false, { message: 'ACCESS_DENIED' });
        }

        if (!systemUser.is_active) {
          console.log('Azure AD: Account disabled:', email);
          return done(null, false, { message: 'ACCOUNT_DISABLED' });
        }

        // Update Azure OID if not set
        if (!systemUser.azure_oid && azureOid) {
          systemUser = await db.updateSystemUserAzureOid(systemUser.id, azureOid);
        }

        console.log('Azure AD: Login successful for:', email);

        return done(null, {
          id: systemUser.id,
          email: systemUser.email,
          name: systemUser.name,
          role: systemUser.role,
          azureOid: systemUser.azure_oid
        });
      } catch (error) {
        console.error('Azure AD: Authentication error:', error);
        return done(error);
      }
    }
  ));

  console.log('Azure AD authentication configured');
} else {
  console.warn('Azure AD credentials not configured - authentication disabled');
}

// Serialize user to session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.getSystemUserById(id);
    if (user && user.is_active) {
      done(null, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      });
    } else {
      done(null, false);
    }
  } catch (error) {
    done(error);
  }
});

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

// Check if user is authenticated
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  // For API requests, return JSON error
  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized', redirectTo: '/login.html' });
  }

  // Store the original URL to redirect back after login
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login.html');
}

// Check if user is admin
function requireAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }

  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  return res.redirect('/access-denied.html');
}

// ==========================================
// STATIC FILES & PUBLIC ROUTES
// ==========================================

// Public static assets (CSS, JS, images)
app.use('/styles.css', express.static(path.join(__dirname, 'public', 'styles.css')));
app.use('/auth.js', express.static(path.join(__dirname, 'public', 'auth.js')));

// Public pages (no auth required)
app.get('/login.html', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/access-denied.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'access-denied.html'));
});

// Protected pages
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve other static files (protected by default via route handlers above)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// Initiate Azure AD login
app.get('/auth/login', (req, res, next) => {
  if (!process.env.AZURE_CLIENT_ID) {
    return res.status(500).send('Azure AD not configured');
  }
  // Save session before redirect to ensure state is persisted
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
    }
    passport.authenticate('azuread-openidconnect', {
      failureRedirect: '/login.html',
      session: true,
      prompt: 'select_account'
    })(req, res, next);
  });
});

// Azure AD callback
app.post('/auth/callback', (req, res, next) => {
  if (req.body.error) {
    console.error('Azure AD error:', req.body.error, req.body.error_description);
    return res.redirect('/access-denied.html');
  }

  passport.authenticate('azuread-openidconnect', (err, user, info) => {
    if (err) {
      console.error('Auth callback error:', err);
      return res.redirect('/access-denied.html');
    }

    if (!user) {
      console.log('Auth denied:', info);
      return res.redirect('/access-denied.html');
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('Session login error:', loginErr);
        return res.redirect('/access-denied.html');
      }

      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
});

// Auth failure handler
app.get('/auth/failure', (req, res) => {
  res.redirect('/access-denied.html');
});

// Logout
app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) console.error('Session destruction error:', err);
      res.clearCookie('connect.sid');

      if (process.env.AZURE_TENANT_ID) {
        const postLogoutRedirect = (process.env.AZURE_REDIRECT_URI || 'http://localhost:3001/auth/callback').replace('/auth/callback', '/login.html');
        const logoutUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirect)}`;
        res.redirect(logoutUrl);
      } else {
        res.redirect('/login.html');
      }
    });
  });
});

// Get current user info
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role
  });
});

// Check auth status (for frontend)
app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.isAuthenticated() ? {
      name: req.user.name,
      role: req.user.role
    } : null
  });
});

// Utility function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Endpoint para obtener datos cacheados
 * GET /getCachedData?department=Concierge&range=thisWeek
 */
app.get('/getCachedData', requireAuth, (req, res) => {
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
app.get('/listCaches', requireAuth, (req, res) => {
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

app.post('/getData', requireAuth, async (req, res) => {
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

app.post('/getDataIndividuals', requireAuth, async (req, res) => {
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
app.get('/api/inboxes', requireAuth, async (req, res) => {
  try {
    const inboxes = await db.getAllInboxes();
    res.json(inboxes);
  } catch (error) {
    console.error('Error getting inboxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single inbox
app.get('/api/inboxes/:id', requireAuth, async (req, res) => {
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

// CREATE inbox (Admin only)
app.post('/api/inboxes', requireAuth, requireAdmin, async (req, res) => {
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

// UPDATE inbox (Admin only)
app.put('/api/inboxes/:id', requireAuth, requireAdmin, async (req, res) => {
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

// DELETE inbox (Admin only)
app.delete('/api/inboxes/:id', requireAuth, requireAdmin, async (req, res) => {
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
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single user
app.get('/api/users/:id', requireAuth, async (req, res) => {
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

// CREATE user (Admin only)
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
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

// UPDATE user (Admin only)
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
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

// DELETE user (Admin only)
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
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
app.get('/api/inboxes/:id/users', requireAuth, async (req, res) => {
  try {
    const users = await db.getUsersByInbox(parseInt(req.params.id));
    res.json(users);
  } catch (error) {
    console.error('Error getting inbox users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ASSIGN user to inbox (Admin only)
app.post('/api/inboxes/:inboxId/users/:userId', requireAuth, requireAdmin, async (req, res) => {
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

// REMOVE user from inbox (Admin only)
app.delete('/api/inboxes/:inboxId/users/:userId', requireAuth, requireAdmin, async (req, res) => {
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
app.get('/api/analytics/inbox/:inboxName', requireAuth, async (req, res) => {
  try {
    const users = await db.getUsersByInboxName(req.params.inboxName);
    res.json(users);
  } catch (error) {
    console.error('Error getting inbox users for analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET individual users (for analytics - replaces JSON file)
app.get('/api/analytics/individuals', requireAuth, async (req, res) => {
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

// GET all teammates from Front API (Admin only)
app.get('/api/front/teammates', requireAuth, requireAdmin, async (req, res) => {
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

// GET all channels (shared inboxes) from Front API (Admin only)
app.get('/api/front/channels', requireAuth, requireAdmin, async (req, res) => {
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

// ==========================================
// API ENDPOINTS - SYSTEM USERS (Admin only)
// ==========================================

// GET all system users
app.get('/api/system-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllSystemUsers();
    res.json(users);
  } catch (error) {
    console.error('Error getting system users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single system user
app.get('/api/system-users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await db.getSystemUserById(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error getting system user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE system user
app.post('/api/system-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, role } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }
    if (role && !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "user"' });
    }
    const user = await db.createSystemUser(email, name, role || 'user');
    res.status(201).json(user);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    console.error('Error creating system user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE system user
app.put('/api/system-users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, role, is_active } = req.body;
    const user = await db.updateSystemUser(
      parseInt(req.params.id),
      email,
      name,
      role,
      is_active !== undefined ? is_active : true
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error updating system user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE system user
app.delete('/api/system-users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Prevent deleting yourself
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const user = await db.deleteSystemUser(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted', user });
  } catch (error) {
    console.error('Error deleting system user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search teammate by email (Admin only)
app.get('/api/front/teammates/search', requireAuth, requireAdmin, async (req, res) => {
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);

  // Start cache scheduler in production or when explicitly enabled
  if (process.env.NODE_ENV === 'production' || process.env.RUN_SCHEDULER === 'true') {
    const cacheScheduler = require('./cache-scheduler');
    console.log('Starting cache scheduler...');
    cacheScheduler.scheduleJobs();
  }
});