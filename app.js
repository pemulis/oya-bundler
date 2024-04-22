const express = require('express');
const bodyParser = require('body-parser');
const { handleIntention, getLatestBundle, publishToIPFS } = require('./handlers');

// Load environment variables
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// Route to receive and process intentions
app.post('/intention', async (req, res) => {
  try {
    const { intention, signature, from } = req.body;
    const response = await handleIntention(intention, signature, from);
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to get the latest bundle
app.get('/bundle', async (req, res) => {
  try {
    const bundle = await getLatestBundle();
    res.status(200).json(bundle);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to publish bundle
app.get('/publish', async (req, res) => {
  try {
    const { data, signature, from } = req.body;
    const response = await publishToIPFS(data, signature, from);
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});