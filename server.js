import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

// Resolve directory paths for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from the 'public' folder
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

// Helper function to pause execution (6 seconds)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to execute individual STK push requests safely
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

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      // Catch instances where API returns an HTML error page or plain text
      data = { rawResponse: responseText };
    }

    return { success: response.ok, status: response.status, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Background batch processing loop with a strict 6-second delay
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
    if (result.success) {
      batchStatus.successful++;
      batchStatus.logs.push({ phone, status: 'SUCCESS', response: result.data });
    } else {
      batchStatus.failed++;
      batchStatus.logs.push({ phone, status: 'FAILED', error: result.data || result.error });
    }

    // Wait 6 seconds before processing the next request (skip delay on the final entry)
    if (i < numbers.length - 1) {
      await delay(6000);
    }
  }

  isProcessing = false;
  console.log('Batch dispatch sequence completed.');
}

// API Route: Trigger batch sequence
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

  // Start background task
  processBatch(numbers, amount, referencePrefix, description);

  res.json({ message: 'Batch dispatch started successfully.', totalNumbers: numbers.length });
});

// API Route: Fetch live progress metrics and logs
app.get('/api/status', (req, res) => {
  res.json({ isProcessing, progress: batchStatus });
});

// Fallback to ensure root serves index.html properly
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`STK Bot Server running smoothly on port ${PORT}`);
});
