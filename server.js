import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SNAPEARN_API_KEY = process.env.SNAPEARN_API_KEY;

let isProcessing = false;
let batchStatus = {
  total: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  logs: []
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendStkPush(phone, amount, reference, description) {
  try {
    // Updated to the correct endpoint without the .php extension
    const response = await fetch("https://api.snapearn.co.ke/api/stk-push", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SNAPEARN_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone: String(phone).trim(),
        amount: Number(amount),
        reference: reference || `REF_${Date.now()}`,
        description: description || "Batch Payment"
      })
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { rawResponse: responseText };
    }

    console.log(`[API Response] Status: ${response.status}`, JSON.stringify(data));

    return { success: response.ok, status: response.status, data };
  } catch (error) {
    console.error("[Network Error]", error.message);
    return { success: false, error: error.message };
  }
}

async function processBatch(numbers, amount, referencePrefix, description) {
  isProcessing = true;
  batchStatus = {
    total: numbers.length,
    processed: 0,
    successful: 0,
    failed: 0,
    logs: []
  };

  for (let i = 0; i < numbers.length; i++) {
    const phone = numbers[i];
    const ref = `${referencePrefix}_${i + 1}`;
    
    console.log(`[${i + 1}/${numbers.length}] Dispatching STK push to ${phone}...`);
    
    const result = await sendStkPush(phone, amount, ref, description);

    batchStatus.processed++;
    if (result.success && (!result.data.error && result.data.status !== 'failed')) {
      batchStatus.successful++;
      batchStatus.logs.push({ phone, status: 'SUCCESS', response: result.data });
    } else {
      batchStatus.failed++;
      batchStatus.logs.push({ phone, status: 'FAILED', error: result.data || result.error });
    }

    if (i < numbers.length - 1) {
      await delay(6000);
    }
  }

  isProcessing = false;
  console.log('Batch dispatch sequence completed.');
}

app.post('/api/dispatch', (req, res) => {
  const { numbers, amount, referencePrefix = 'BATCH', description = 'Order Payment' } = req.body;

  if (isProcessing) {
    return res.status(429).json({ error: 'A batch run is currently in progress. Please wait.' });
  }

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Please provide a valid list of phone numbers.' });
  }

  if (!amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Please provide a valid transaction amount.' });
  }

  processBatch(numbers, amount, referencePrefix, description);
  res.json({ message: 'Batch dispatch started successfully.', totalNumbers: numbers.length });
});

app.get('/api/status', (req, res) => {
  res.json({ isProcessing, progress: batchStatus });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`STK Bot Server running smoothly on port ${PORT}`);
});
