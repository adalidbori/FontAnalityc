const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = 3001;

const ENDPOINT = process.env.ENDPOINT;
const FRONT_API_KEY = process.env.FRONT_API_KEY;
const FRONT_API_KEY_INDIVIDUALS = process.env.FRONT_API_KEY_INDIVIDUALS;

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
      const result = await callFrontApi(requestBody, index + 1);
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
          Authorization: FRONT_API_KEY_INDIVIDUALS,
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

app.listen(3001, '0.0.0.0', () => {
  console.log('Listing on http://192.168.1.158:3001');
});