import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the static frontend dashboard
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
    const response = await fetch("https://api.snapearn.co.ke/api/stk-push.php", {
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

    const data = await response.json();
    return { success: response.ok, status: response.status, data };
  } catch (error) {
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
    
    const result = await sendStkPush(phone, amount, ref, description);

    batchStatus.processed++;
    if (result.success) {
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
}

app.post('/api/dispatch', (req, res) => {
  const { numbers, amount, referencePrefix = 'BATCH', description = 'Order Payment' } = req.body;

  if (isProcessing) {
    return res.status(429).json({ error: 'A batch run is currently in progress.' });
  }

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one valid phone number.' });
  }

  processBatch(numbers, amount, referencePrefix, description);

  res.json({ message: 'Batch dispatch started.', totalNumbers: numbers.length });
});

app.get('/api/status', (req, res) => {
  res.json({ isProcessing, progress: batchStatus });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
