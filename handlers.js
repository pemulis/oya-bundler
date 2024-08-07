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

const OYA_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001"; // Oya token address placeholder
const OYA_REWARD_AMOUNT = BigInt(1 * 10 ** 18); // 1 Oya token with 18 decimals

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
    console.log('Parsed bundle data:', bundleData); // Debug log
  } catch (error) {
    console.error("Failed to parse bundle data:", error);
    throw new Error("Invalid bundle data");
  }

  // Check the structure of bundleData
  if (!Array.isArray(bundleData.bundle)) {
    console.error("Invalid bundle data structure:", bundleData);
    throw new Error("Invalid bundle data structure");
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

  // Process balance updates
  try {
    for (const execution of bundleData.bundle) { // Reference 'bundle' instead of 'execution'
      if (!Array.isArray(execution.proof)) {
        console.error("Invalid proof structure in execution:", execution);
        throw new Error("Invalid proof structure");
      }
      for (const proof of execution.proof) {
        await updateBalances(proof.from, proof.to, proof.token, proof.amount);
      }
    }
    console.log('Balances updated successfully'); // Debug log
  } catch (error) {
    console.error("Failed to update balances:", error);
    throw new Error("Balance update failed");
  }

  // Mint rewards for all unique 'from' addresses in the bundle
  try {
    await mintRewards(bundleData.rewards.map(reward => reward.account));
    console.log('Rewards minted successfully'); // Debug log
  } catch (error) {
    console.error("Failed to mint rewards:", error);
    throw new Error("Minting rewards failed");
  }

  // Update the nonce for each account in the bundle
  try {
    for (const execution of bundleData.bundle) {
      const accountNonce = execution.intention.nonce; // Get the nonce from the intention
      const account = execution.intention.from; // Get the account from the intention
      const nonceResponse = await axios.post(`${process.env.OYA_API_BASE_URL}/nonce/${account}`, {
        nonce: accountNonce
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log(`Nonce set for account ${account}: ${JSON.stringify(nonceResponse.data)}`);
    }
  } catch (error) {
    console.error(`Failed to set nonce for accounts in the bundle:`, error);
    throw new Error("Nonce update failed");
  }

  return cid;
}

async function updateBalances(from, to, token, amount) {
  try {
    // Ensure the accounts are initialized
    await initializeAccount(from);
    await initializeAccount(to);

    // Convert amount to BigInt
    amount = convertToBigInt(amount);

    // Retrieve the current balance for 'from' account
    const fromResponse = await axios.get(`${process.env.OYA_API_BASE_URL}/balance/${from}/${token}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    let fromBalance = fromResponse.data.length > 0 ? convertToBigInt(fromResponse.data[0].balance) : BigInt(0);
    console.log(`Current balance for from account (${from}): ${fromBalance}`); // Debug log

    // Retrieve the current balance for 'to' account
    const toResponse = await axios.get(`${process.env.OYA_API_BASE_URL}/balance/${to}/${token}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    let toBalance = toResponse.data.length > 0 ? convertToBigInt(toResponse.data[0].balance) : BigInt(0);
    console.log(`Current balance for to account (${to}): ${toBalance}`); // Debug log

    // Calculate new balances
    const newFromBalance = fromBalance - amount;
    const newToBalance = toBalance + amount;

    // Ensure newFromBalance is not negative
    if (newFromBalance < 0n) {
      throw new Error('Insufficient balance in from account');
    }

    console.log(`New balance for from account (${from}): ${newFromBalance}`); // Debug log
    console.log(`New balance for to account (${to}): ${newToBalance}`); // Debug log

    // Update balances for 'from' account
    const fromUpdateResponse = await axios.post(`${process.env.OYA_API_BASE_URL}/balance`, {
      account: from,
      token: token,
      balance: newFromBalance.toString()
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`From account update response: ${JSON.stringify(fromUpdateResponse.data)}`); // Debug log

    // Update balances for 'to' account
    const toUpdateResponse = await axios.post(`${process.env.OYA_API_BASE_URL}/balance`, {
      account: to,
      token: token,
      balance: newToBalance.toString()
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`To account update response: ${JSON.stringify(toUpdateResponse.data)}`); // Debug log

    console.log(`Balances updated: from ${from} to ${to} for token ${token} amount ${amount}`);
  } catch (error) {
    console.error("Failed to update balances:", error);
    throw new Error("Balance update failed");
  }
}

function convertToBigInt(amount) {
  if (amount.includes('e+')) {
    // Convert exponential form to BigInt
    const [mantissa, exponent] = amount.split('e+');
    const bigIntMantissa = BigInt(mantissa.replace('.', ''));
    const bigIntExponent = BigInt(exponent);
    const bigIntValue = bigIntMantissa * (10n ** bigIntExponent);
    return bigIntValue;
  } else {
    // Handle as regular BigInt
    return BigInt(amount);
  }
}

async function initializeAccount(account) {
  try {
    const url = `${process.env.OYA_API_BASE_URL}/balance/${account}`;
    console.log(`Checking balance for account (${account}): ${url}`);
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // If the account is not found, initialize it with test tokens
    if (response.data.length === 0) {
      await initializeBalancesForAccount(account);
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // If the balance is not found, initialize the account with default balances
      await initializeBalancesForAccount(account);
    } else {
      console.error(`Failed to initialize account ${account}:`, error);
      throw new Error("Account initialization failed");
    }
  }
}

async function initializeBalancesForAccount(account) {
  console.log(`Initializing account ${account} with test tokens`);
  const initialBalance18 = (10000n * 10n ** 18n).toString(); // 10,000 tokens with 18 decimals
  const initialBalance6 = (1000000n * 10n ** 6n).toString(); // 1,000,000 tokens with 6 decimals
  const initialOyaBalance = (111n * 10n ** 18n).toString(); // 111 Oya tokens with 18 decimals

  const supportedTokens18 = [
    "0x0000000000000000000000000000000000000000", // raw ETH
    "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828", // UMA
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // WETH
  ];
  const supportedTokens6 = [
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // USDC
  ];
  const oyaTokens = [
    "0x0000000000000000000000000000000000000001"  // OYA
  ];

  for (const token of supportedTokens18) {
    console.log(`Initializing ${token} for account ${account} with balance ${initialBalance18}`);
    await axios.post(`${process.env.OYA_API_BASE_URL}/balance`, {
      account: account,
      token: token,
      balance: initialBalance18
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  for (const token of supportedTokens6) {
    console.log(`Initializing ${token} for account ${account} with balance ${initialBalance6}`);
    await axios.post(`${process.env.OYA_API_BASE_URL}/balance`, {
      account: account,
      token: token,
      balance: initialBalance6
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  for (const token of oyaTokens) {
    console.log(`Initializing ${token} for account ${account} with balance ${initialOyaBalance}`);
    await axios.post(`${process.env.OYA_API_BASE_URL}/balance`, {
      account: account,
      token: token,
      balance: initialOyaBalance
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  console.log(`Account ${account} initialized with test tokens`);
}

// Cache intentions to be added to a bundle
let cachedIntentions = [];

async function handleIntention(intention, signature, from) {
  initializeAccount(from); // Ensure the account is initialized

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

  if (txDetails[0].action === "transfer" || txDetails[0].action === "swap") {
    const tokenAddress = txDetails[0].data.fromToken.address;
    const amount = txDetails[0].data.fromAmount;

    // Convert amount to BigInt
    const convertedAmount = convertToBigInt(amount);

    // Fetch the current balance of the sender
    const response = await axios.get(`${process.env.OYA_API_BASE_URL}/balance/${from}/${tokenAddress}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let currentBalance = response.data.length > 0 ? BigInt(response.data[0].balance) : BigInt(0);

    // Check if the sender has enough balance
    if (currentBalance < convertedAmount) {
      console.error(`Insufficient balance. Current: ${currentBalance}, Required: ${convertedAmount}`);
      throw new Error('Insufficient balance');
    }

    if (txDetails[0].action === "swap") {
      swapInput = {
        token: txDetails[0].data.fromToken.address,
        chainId: txDetails[0].data.fromToken.chainId,
        from: txDetails[0].data.fromAddress,
        to: BUNDLER_ADDRESS,
        amount: txDetails[0].data.fromAmount,
        tokenId: 0 // this field is for NFTs, which are not yet supported
      };
      proof.push(swapInput);
      console.log('swapInput:', swapInput); // Debug log

      // Second proof is the bundler filling the other side of the swap based on market price
      swapOutput = {
        token: txDetails[0].data.toToken.address,
        chainId: txDetails[0].data.toToken.chainId,
        from: BUNDLER_ADDRESS,
        to: txDetails[0].data.fromAddress,
        amount: txDetails[0].data.toAmount,
        tokenId: 0 // this field is for NFTs, which are not yet supported
      };
      proof.push(swapOutput);
      console.log('swapOutput:', swapOutput); // Debug log;
    } else {
      // Handle a regular transfer
      transfer = {
        token: txDetails[0].data.fromToken.address,
        chainId: txDetails[0].data.fromToken.chainId,
        from: txDetails[0].data.fromAddress,
        to: txDetails[0].data.toAddress,
        amount: txDetails[0].data.toAmount,
        tokenId: 0 // this field is for NFTs, which are not yet supported
      };
      proof.push(transfer);
      console.log('transfer:', transfer); // Debug log
    }
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

  console.log("Intention sent by live tester");
  cachedIntentions.push(executionObject);
  console.log('Cached intentions:', cachedIntentions); // Debug log

  return executionObject;
}

// Function to get the latest nonce from the Oya API
async function getLatestNonce() {
  try {
    const response = await axios.get(`${process.env.OYA_API_BASE_URL}/bundle`);
    const bundles = response.data;
    console.log('Bundles:', bundles); // Debug log

    if (bundles.length === 0) {
      return 0;
    }

    return bundles[0].nonce + 1;
  } catch (error) {
    console.error("Failed to fetch bundles from Oya API:", error);
    throw new Error("API request failed");
  }
}

async function createAndPublishBundle() {
  if (cachedIntentions.length === 0) {
    console.log("No intentions to bundle.");
    return;
  }

  console.log('createAndPublishBundle called'); // Debug log
  console.log('Cached intentions before bundling:', cachedIntentions); // Debug log

  // Get the latest nonce
  let nonce;
  try {
    nonce = await getLatestNonce();
  } catch (error) {
    console.error("Failed to get latest nonce:", error);
    return;
  }

  const bundle = cachedIntentions.map(({ execution }) => execution).flat();

  // Collect all unique 'from' addresses for rewards
  const rewardAddresses = [...new Set(bundle.flatMap(execution => execution.proof.map(proof => proof.from)))];

  const bundleObject = {
    bundle: bundle,
    nonce: nonce, // dynamically fetched nonce
    rewards: rewardAddresses.map(address => ({
      account: address,
      token: OYA_TOKEN_ADDRESS,
      amount: OYA_REWARD_AMOUNT.toString()
    }))
  };

  const bundlerSignature = await wallet.signMessage(JSON.stringify(bundleObject));
  try {
    await publishBundle(JSON.stringify(bundleObject), bundlerSignature, BUNDLER_ADDRESS);
  } catch (error) {
    console.error("Failed to publish bundle:", error);
    return;
  }

  // Clear the cache after publishing
  cachedIntentions = [];
}

async function mintRewards(addresses) {
  try {
    for (const address of addresses) {
      // Ensure the account is initialized
      await initializeAccount(address);

      // Retrieve the current balance for the address
      let currentBalance;
      try {
        const response = await axios.get(`${process.env.OYA_API_BASE_URL}/balance/${address}/${OYA_TOKEN_ADDRESS}`, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        currentBalance = response.data.length > 0 ? convertToBigInt(response.data[0].balance) : BigInt(0);
      } catch (error) {
        if (error.response && error.response.status === 404) {
          // If the balance is not found, initialize it with 0
          currentBalance = BigInt(0);
        } else {
          throw error;
        }
      }

      // Mint 1 Oya token (assume 18 decimals)
      const newBalance = currentBalance + OYA_REWARD_AMOUNT;

      // Update balance for the address
      const updateResponse = await axios.post(`${process.env.OYA_API_BASE_URL}/balance`, {
        account: address,
        token: OYA_TOKEN_ADDRESS,
        balance: newBalance.toString()
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`Minted 1 Oya token for ${address}, new balance: ${newBalance}`);
    }
  } catch (error) {
    console.error("Failed to mint rewards:", error);
    throw new Error("Minting rewards failed");
  }
}

module.exports = { handleIntention, createAndPublishBundle, _getCachedIntentions: () => cachedIntentions, _clearCachedIntentions: () => { cachedIntentions = []; } };
