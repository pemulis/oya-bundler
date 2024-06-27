// Load environment variables
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ethers } = require("ethers");
const { Alchemy, Wallet } = require("alchemy-sdk");

const settings = {
  apiKey: process.env.ALCHEMY_API_KEY,
  network: "eth-sepolia"
};

const alchemy = new Alchemy(settings);

// Define the contract address and the Sepolia provider
const contractAddress = process.env.BUNDLE_TRACKER_ADDRESS;

// Define the private key of the bundler (for signing the transaction)
const wallet = new Wallet(process.env.TEST_PRIVATE_KEY, alchemy);

// Read the contract ABI from the JSON file
const abiPath = path.join(__dirname, 'abi', 'BundleTracker.json');
const contractABI = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

// Create a contract instance
const bundleTrackerContract = new ethers.Contract(contractAddress, contractABI, wallet);

let brian;

(async () => {
  try {
    const { BrianSDK } = await import('@brian-ai/sdk');

    const options = {
      apiKey: process.env.BRIAN_API_KEY,
      apiUrl: process.env.BRIAN_API_URL,
    };

    brian = new BrianSDK(options);

  } catch (err) {
    console.error('Error importing BrianSDK:', err);
  }
})();

// Variables for Helia instances
let createHelia, strings, s;

// Dynamically import Helia and related modules
async function setupHelia() {
  const heliaModule = await import('helia');
  createHelia = heliaModule.createHelia;
  const stringsModule = await import('@helia/strings');
  strings = stringsModule.strings;
  
  const helia = await createHelia(); // Create a Helia node
  s = strings(helia); // Initialize strings with the Helia node
}

async function ensureHeliaSetup() {
  if (!s) {
    await setupHelia();
  }
}

// Hardcoded address for the bundler
const BUNDLER_ADDRESS = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf'; // for testing, insecure

// Function to publish data to IPFS with signature validation
async function publishBundle(data, signature, from) {
  await ensureHeliaSetup();  // Ensure Helia is ready before proceeding
  console.log('publishBundle called'); // Debug log
  if (from !== BUNDLER_ADDRESS) {
    throw new Error("Unauthorized: Only the bundler can publish new bundles.");
  }

  const signerAddress = ethers.verifyMessage(data, signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  console.log('Publishing data to IPFS'); // Debug log
  const cid = await s.add(data);  // Ensure this is defined and accessible
  const cidToString = cid.toString();
  console.log('Published to IPFS, CID:', cidToString); // Debug log

  // Call the proposeBundle function on the contract
  try {
    const tx = await bundleTrackerContract.proposeBundle(cidToString);
    await alchemy.transact.waitForTransaction(tx.hash);
    console.log('Blockchain transaction successful'); // Debug log
  } catch (error) {
    console.error("Failed to propose bundle:", error);
    throw new Error("Blockchain transaction failed");
  }

  // Parse the data to ensure it is valid JSON
  let bundleData;
  try {
    bundleData = JSON.parse(data);
  } catch (error) {
    console.error("Failed to parse bundle data:", error);
    throw new Error("Invalid bundle data");
  }

  // Send bundle data to Oya API
  try {
    await axios.post(`${process.env.OYA_API_BASE_URL}/bundle`, bundleData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('Bundle data sent to Oya API'); // Debug log
  } catch (error) {
    console.error("Failed to send bundle data to Oya API:", error);
    throw new Error("API request failed");
  }

  // Send CID and nonce to Oya API
  try {
    await axios.post(`${process.env.OYA_API_BASE_URL}/cid`, {
      cid: cidToString,
      nonce: bundleData.nonce // need to do proper nonce handling
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('CID sent to Oya API'); // Debug log
  } catch (error) {
    console.error("Failed to send CID to Oya API:", error);
    throw new Error("API request failed");
  }
  
  return cid;
}


// Cache intentions to be added to a bundle
let cachedIntentions = [];

async function handleIntention(intention, signature, from) {
  console.log('handleIntention called'); // Debug log
  const signerAddress = ethers.verifyMessage(JSON.stringify(intention), signature);
  console.log(`signerAddress: ${signerAddress}, from: ${from}`); // Debug log
  if (signerAddress !== from) {
    console.log("Signature verification failed");
    throw new Error("Signature verification failed");
  }

  // Ensure Brian is initialized
  if (!brian) {
    console.log("Brian SDK not initialized");
    throw new Error("Brian SDK not initialized");
  }

  console.log('Calling brian.transact'); // Debug log
  const txDetails = await brian.transact({
    prompt: intention.action,
    address: from,
  });

  console.log('txDetails:', txDetails); // Debug log
  const proof = [];

  if (txDetails[0].action === "transfer") {
    proof.push({
      token: txDetails[0].data.fromToken.address,
      chainId: txDetails[0].data.fromToken.chainId,
      from: txDetails[0].data.fromAddress,
      to: txDetails[0].data.toAddress,
      amount: txDetails[0].data.toAmount,
      tokenId: 0 // this field is for NFTs, which are not yet supported
    });
  } else if (txDetails[0].action === "swap") {
    proof.push({
      token: txDetails[0].data.fromToken.address,
      chainId: txDetails[0].data.fromToken.chainId,
      from: txDetails[0].data.fromAddress,
      to: txDetails[0].data.toAddress,
      amount: txDetails[0].data.toAmount,
      tokenId: 0 // this field is for NFTs, which are not yet supported
    });
    // second proof is the bundler filling the other side of the swap based on market price
    proof.push({
      token: txDetails[0].data.toToken.address,
      chainId: txDetails[0].data.toToken.chainId,
      from: BUNDLER_ADDRESS,
      to: txDetails[0].data.fromAddress,
      amount: txDetails[0].data.toAmount,
      tokenId: 0 // this field is for NFTs, which are not yet supported
    });
  } else {
    console.error("Unexpected action:", txDetails[0].action);
  }

  const executionObject = {
    execution: [
      {
        intention: intention,
        proof: proof
      }
    ]
  };

  console.log(`Checking authorized addresses: ${signerAddress === "0x0B42AA7409a9712005dB492945855C176d9C2811" || signerAddress === "0xc14F7b08c8ac542278CC92545F61fa881124BBeC" || signerAddress === "0x3526e4f3E4EC41E7Ff7743F986FCEBd3173F657E"}`);
  if (signerAddress === "0x0B42AA7409a9712005dB492945855C176d9C2811" || signerAddress === "0xc14F7b08c8ac542278CC92545F61fa881124BBeC" || signerAddress === "0x3526e4f3E4EC41E7Ff7743F986FCEBd3173F657E") {
    console.log("Intention sent by authorized live tester");
    cachedIntentions.push(executionObject);
    console.log('Cached intentions:', cachedIntentions); // Debug log
  } else {
    console.log("Signer not authorized for caching intentions");
  }

  return executionObject;
}

async function createAndPublishBundle() {
  if (cachedIntentions.length === 0) {
    console.log("No intentions to bundle.");
    return;
  }

  console.log('createAndPublishBundle called'); // Debug log
  console.log('Cached intentions before bundling:', cachedIntentions); // Debug log

  const bundle = cachedIntentions.map(({ execution }) => execution).flat();

  const bundleObject = {
    bundle: bundle,
    nonce: 1337 // hardcoded nonce, let's fix this later
  };

  const bundlerSignature = await wallet.signMessage(JSON.stringify(bundleObject));
  await publishBundle(JSON.stringify(bundleObject), bundlerSignature, BUNDLER_ADDRESS);

  // Clear the cache after publishing
  cachedIntentions = [];
}

module.exports = { handleIntention, createAndPublishBundle, _getCachedIntentions: () => cachedIntentions, _clearCachedIntentions: () => { cachedIntentions = []; } };
