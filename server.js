const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = 3001;

const ENDPOINT = process.env.ENDPOINT;
const FRONT_API_KEY = process.env.FRONT_API_KEY;

// Debug .env
console.log('.env exists:', fs.existsSync(path.join(__dirname, '.env')));
console.log('ENDPOINT:', ENDPOINT);
console.log('FRONT_API_KEY:', FRONT_API_KEY);

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
        const result = await callFrontApi(requestBody, index + 1);
        apiResponses.push({
          recordIndex: index + 1,
          record,
          ...result,
        });
  
        // Wait 2 seconds before the next record (except after the last one)
        if (index < registros.length - 1) {
          console.log(`Waiting 2 seconds before processing next record...`);
          await delay(5000); // Corrected to 2 seconds
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

// Function to call FRONT API with retries
async function callFrontApi(requestBody, recordIndex) {
    const maxRetries = 10;
    let retries = 0;
  
    while (retries < maxRetries) {
      try {
        console.log(`Attempt ${retries + 1} for record ${recordIndex}:`, requestBody);
        const frontResponse = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: FRONT_API_KEY,
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
          await delay(5000); // 2 seconds between retries
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

app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});