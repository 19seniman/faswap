const axios = require('axios');
const ethers = require('ethers');
const dotenv = require('dotenv');
const readline = require('readline');
const fs = require('fs');

dotenv.config();

// ERC20 ABI for common token functions
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

/**
 * Builds a fallback JSON RPC provider with retry logic.
 * @param {string[]} rpcUrls - Array of RPC URLs.
 * @param {number} chainId - Chain ID.
 * @param {string} name - Network name.
 * @returns {object} An object with a getProvider method that returns a working provider.
 */
async function buildFallbackProvider(rpcUrls, chainId, name) {
  const provider = new ethers.JsonRpcProvider(rpcUrls[0], { chainId, name });
  return {
    getProvider: async () => {
      // Retry connecting to the RPC up to 3 times if it's busy
      for (let i = 0; i < 3; i++) {
        try {
          await provider.getBlockNumber(); // Test connection
          return provider;
        } catch (e) {
          // Specific error handling for RPC busy
          if (e.code === 'UNKNOWN_ERROR' && e.error && e.error.code === -32603) {
            console.log(`${colors.yellow}[⚠] RPC busy, retrying ${i + 1}/3...${colors.reset}`);
            await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds before retrying
            continue;
          }
          throw e; // Re-throw other errors
        }
      }
      throw new Error('All RPC retries failed'); // If all retries fail
    }
  };
}

// Console colors for better logging
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m"
};

// Custom logger for consistent output
const logger = {
    info: (msg) => console.log(`${colors.cyan}[i] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[x] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.magenta}[*] ${msg}${colors.reset}`),
    step: (msg) => console.log(`${colors.blue}[>] ${colors.bold}${msg}${colors.reset}`),
    critical: (msg) => console.log(`${colors.red}${colors.bold}[FATAL] ${msg}${colors.reset}`),
    summary: (msg) => console.log(`${colors.green}${colors.bold}[SUMMARY] ${msg}${colors.reset}`),
    banner: () => {
        const border = `${colors.blue}${colors.bold}╔═════════════════════════════════════════╗${colors.reset}`;
        const title = `${colors.blue}${colors.bold}║   🍉 19Seniman From Insider  🍉   ║${colors.reset}`;
        const bottomBorder = `${colors.blue}${colors.bold}╚═════════════════════════════════════════╝${colors.reset}`;
        
        console.log(`\n${border}`);
        console.log(`${title}`);
        console.log(`${bottomBorder}\n`);
    },
    section: (msg) => {
        const line = '─'.repeat(40);
        console.log(`\n${colors.gray}${line}${colors.reset}`);
        if (msg) console.log(`${colors.white}${colors.bold} ${msg} ${colors.reset}`);
        console.log(`${colors.gray}${line}${colors.reset}\n`);
    },
};

// Token addresses and swap constants
const TOKENS = {
  PHRS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token equivalent for DODO
  USDT: '0xD4071393f8716661958F766DF660033b3d35fD29' // USDT on Pharos Testnet
};

const PHAROS_CHAIN_ID = 688688;
const PHAROS_RPC_URLS = ['https://api.zan.top/node/v1/pharos/testnet/bf44f87e170345c0aedef65e9311860d'];
const DODO_ROUTER = '0x73CAfc894dBfC181398264934f7Be4e482fc9d40'; // DODO router address

// Swap amounts (parsed to BigInt for ethers)
const PHRS_TO_USDT_AMOUNT = ethers.parseEther('0.00245'); // 0.00245 PHRS
const USDT_TO_PHRS_AMOUNT = ethers.parseUnits('1', 6); // 1 USDT (USDT has 6 decimals)

// User agents for HTTP requests to mimic browser behavior
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0'
];

/**
 * Gets a random user agent from the list.
 * @returns {string} A random user agent string.
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Loads private keys from environment variables (PRIVATE_KEY_1, PRIVATE_KEY_2, etc.).
 * @returns {string[]} An array of valid private keys.
 */
function loadPrivateKeys() {
  const keys = [];
  let i = 1;
  while (process.env[`PRIVATE_KEY_${i}`]) {
    const pk = process.env[`PRIVATE_KEY_${i}`];
    // Basic validation for private key format
    if (pk.startsWith('0x') && pk.length === 66) {
      keys.push(pk);
    } else {
      logger.warn(`Invalid PRIVATE_KEY_${i} in .env, skipping...`);
    }
    i++;
  }
  return keys;
}

/**
 * Fetches data from a URL with a specified timeout.
 * @param {string} url - The URL to fetch.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<axios.AxiosResponse>} The Axios response.
 * @throws {Error} If a timeout or network error occurs.
 */
async function fetchWithTimeout(url, timeout = 15000) {
  try {
    const source = axios.CancelToken.source();
    // Set a timeout to cancel the request
    const timeoutId = setTimeout(() => source.cancel('Timeout'), timeout);
    const res = await axios.get(url, {
      cancelToken: source.token,
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.8',
        'priority': 'u=1, i',
        'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'sec-gpc': '1',
        'Referer': 'https://faroswap.xyz/', // Referer header
        'User-Agent': getRandomUserAgent() // Random user agent
      }
    });
    clearTimeout(timeoutId); // Clear timeout if request completes
    return res;
  } catch (err) {
    throw new Error('Timeout or network error');
  }
}

/**
 * Robustly fetches DODO route data with multiple retries.
 * @param {string} url - The DODO API URL.
 * @returns {Promise<object>} The DODO API response data.
 * @throws {Error} If DODO API permanently fails.
 */
async function robustFetchDodoRoute(url) {
  for (let i = 0; i < 5; i++) { // Retry up to 5 times
    try {
      const res = await fetchWithTimeout(url);
      const data = res.data;
      if (data.status !== -1) return data; // Success if status is not -1
      logger.warn(`Retry ${i + 1} DODO API status -1`);
    } catch (e) {
      logger.warn(`Retry ${i + 1} failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds before retrying
  }
  throw new Error('DODO API permanently failed'); // If all retries fail
}

/**
 * Fetches the DODO swap route.
 * @param {string} fromAddr - Address of the token to swap from.
 * @param {string} toAddr - Address of the token to swap to.
 * @param {string} userAddr - User's wallet address.
 * @param {bigint} amountWei - Amount to swap in wei.
 * @returns {Promise<object>} The DODO route data.
 * @throws {Error} If DODO API fetch fails.
 */
async function fetchDodoRoute(fromAddr, toAddr, userAddr, amountWei) {
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes deadline
  const url = `https://api.dodoex.io/route-service/v2/widget/getdodoroute?chainId=${PHAROS_CHAIN_ID}&deadLine=${deadline}&apikey=a37546505892e1a952&slippage=3.225&source=dodoV2AndMixWasm&toTokenAddress=${toAddr}&fromTokenAddress=${fromAddr}&userAddr=${userAddr}&estimateGas=true&fromAmount=${amountWei}`;
  try {
    const result = await robustFetchDodoRoute(url);
    // Validate the response structure
    if (!result.data || !result.data.data) {
      throw new Error('Invalid DODO API response: missing data field');
    }
    logger.success('DODO Route Info fetched successfully');
    return result.data;
  } catch (err) {
    logger.error(`DODO API fetch failed: ${err.message}`);
    throw err;
  }
}

/**
 * Approves a token for spending by the DODO router.
 * @param {ethers.Wallet} wallet - The wallet to use for approval.
 * @param {string} tokenAddr - Address of the token to approve.
 * @param {bigint} amount - Amount to approve.
 * @returns {Promise<boolean>} True if approval is successful or already exists, false otherwise.
 */
async function approveToken(wallet, tokenAddr, amount) {
  // Native token (PHRS) does not require approval
  if (tokenAddr === TOKENS.PHRS) return true;

  const contract = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  try {
    // Check balance
    const balance = await contract.balanceOf(wallet.address);
    if (balance < amount) {
      logger.error(`Insufficient USDT balance: ${ethers.formatUnits(balance, 6)} USDT`);
      return false;
    }

    // Check current allowance
    const allowance = await contract.allowance(wallet.address, DODO_ROUTER);
    if (allowance >= amount) {
      logger.info('Token already approved');
      return true;
    }

    // Approve the token
    logger.step(`Approving ${ethers.formatUnits(amount, 6)} USDT for DODO router`);
    const tx = await contract.approve(DODO_ROUTER, amount);
    logger.success(`Approval TX sent: ${tx.hash}`);
    await tx.wait(); // Wait for transaction confirmation
    logger.success('Approval confirmed');
    return true;
  } catch (e) {
    logger.error(`Approval failed: ${e.message}`);
    return false;
  }
}

/**
 * Executes a swap transaction.
 * @param {ethers.Wallet} wallet - The wallet to use for the swap.
 * @param {object} routeData - The DODO route data containing transaction details.
 * @param {string} fromAddr - Address of the token being swapped from.
 * @param {bigint} amount - The amount of token being swapped.
 * @throws {Error} If token approval fails or swap transaction fails.
 */
async function executeSwap(wallet, routeData, fromAddr, amount) {
  // Approve token if it's not the native token
  if (fromAddr !== TOKENS.PHRS) {
    const approved = await approveToken(wallet, fromAddr, amount);
    if (!approved) throw new Error('Token approval failed');
  }

  try {
    // Validate route data for transaction
    if (!routeData.data || routeData.data === '0x') {
      throw new Error('Invalid transaction data from DODO API');
    }

    // Send the swap transaction
    const tx = await wallet.sendTransaction({
      to: routeData.to,
      data: routeData.data,
      value: BigInt(routeData.value), // Value for native token transfers
      gasLimit: BigInt(routeData.gasLimit || 500000) // Use gasLimit from routeData or a default
    });
    logger.success(`Swap Transaction sent! TX Hash: ${tx.hash}`);
    await tx.wait(); // Wait for transaction confirmation
    logger.success('Transaction confirmed!');
  } catch (e) {
    logger.error(`Swap TX failed: ${e.message}`);
    throw e;
  }
}

/**
 * Performs a batch of alternating PHRS-USDT and USDT-PHRS swaps.
 * @param {ethers.Wallet} wallet - The wallet to use for swaps.
 * @param {number} count - The number of swaps to perform.
 */
async function batchSwap(wallet, count) {
  const swaps = [];
  // Prepare swap pairs (alternating PHRS->USDT and USDT->PHRS)
  for (let i = 0; i < count; i++) {
    swaps.push(i % 2 === 0 ?
      { from: TOKENS.PHRS, to: TOKENS.USDT, amount: PHRS_TO_USDT_AMOUNT, decimals: 18 } :
      { from: TOKENS.USDT, to: TOKENS.PHRS, amount: USDT_TO_PHRS_AMOUNT, decimals: 6 }
    );
  }

  // Execute each swap in the batch
  for (let i = 0; i < swaps.length; i++) {
    const { from, to, amount, decimals } = swaps[i];
    const pair = from === TOKENS.PHRS ? 'PHRS -> USDT' : 'USDT -> PHRS';
    logger.step(`Swap #${i + 1} of ${count}: ${pair}`);
    try {
      const data = await fetchDodoRoute(from, to, wallet.address, amount);
      await executeSwap(wallet, data, from, amount);
    } catch (e) {
      logger.error(`Swap #${i + 1} failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // Short delay between swaps
  }
}

/**
 * Pauses execution for a given duration and displays a countdown.
 * @param {number} ms - The duration to sleep in milliseconds.
 */
async function sleepWithCountdown(ms) {
  return new Promise(resolve => {
    let remaining = ms;
    const interval = setInterval(() => {
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      logger.countdown(`Next swap cycle in ${hours}h ${minutes}m ${seconds}s`);

      remaining -= 1000;
      if (remaining <= 0) {
        clearInterval(interval);
        process.stdout.write('\n'); // New line after countdown finishes
        resolve();
      }
    }, 1000);
  });
}

// Setup readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Promisified readline question function.
 * @param {string} query - The question to ask the user.
 * @returns {Promise<string>} The user's input.
 */
function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Main execution block
(async () => {
  logger.banner(); // Display the banner

  // Build and get the RPC provider
  const fallbackProvider = await buildFallbackProvider(PHAROS_RPC_URLS, PHAROS_CHAIN_ID, 'pharos');
  const provider = await fallbackProvider.getProvider();

  // Load private keys from .env
  const privateKeys = loadPrivateKeys();

  if (privateKeys.length === 0) {
    logger.error('No valid private keys found in .env. Please set PRIVATE_KEY_1, PRIVATE_KEY_2, etc.');
    process.exit(1);
  }

  try {
    // Use the first private key for the wallet
    const wallet = new ethers.Wallet(privateKeys[0], provider);
    logger.success(`Wallet loaded: ${wallet.address}`);

    // Main loop for daily swap cycles
    while (true) {
      const count = await question(`${colors.cyan}How many swaps to perform (PHRS-USDT/USDT-PHRS)? ${colors.reset}`);
      try {
        const countNum = parseInt(count);
        if (isNaN(countNum) || countNum < 1) {
          throw new Error('Invalid swap count. Please enter a positive number.');
        }

        logger.loading(`Starting ${countNum} swaps for wallet ${wallet.address}...`);
        await batchSwap(wallet, countNum); // Perform the batch swaps
        logger.success('Swap cycle completed!');

        logger.step('Waiting for the next 24-hour cycle...');
        // Wait for 24 hours (24 hours * 60 minutes/hour * 60 seconds/minute * 1000 milliseconds/second)
        await sleepWithCountdown(24 * 60 * 60 * 1000);
        logger.info('Starting a new swap cycle.');
      } catch (e) {
        logger.error(`Error during swap cycle: ${e.message}`);
        // If an error occurs, wait for 1 minute before asking for input again
        logger.step('An error occurred. Waiting 60 seconds before retrying...');
        await sleepWithCountdown(60 * 1000);
      }
    }
  } catch (err) {
    logger.error(`Critical error during wallet setup or main loop: ${err.message}`);
    process.exit(1); // Exit if a critical error occurs
  } finally {
    rl.close(); // Close the readline interface when done
  }
})();
