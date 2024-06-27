const express = require('express');
const bodyParser = require('body-parser');
const { handleIntention, createAndPublishBundle } = require('./handlers');

// Load environment variables
require('dotenv').config();

const app = express();

app.use(bodyParser.json());

// Route to receive and process intentions
app.post('/intention', async (req, res) => {
  try {
    const { intention, signature, from } = req.body;
    if (!intention || !signature || !from) {
      throw new Error('Missing required fields');
    }
    console.log('Received signed intention:', intention, signature, from);
    const response = await handleIntention(intention, signature, from);
    res.status(200).json(response);
  } catch (error) {
    console.error('Error handling intention:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set up a timer to publish the bundle every ten minutes
setInterval(async () => {
  try {
    await createAndPublishBundle();
  } catch (error) {
    console.error('Error creating and publishing bundle:', error);
  }
}, 5 * 60 * 1000); // 5 minutes in milliseconds

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
