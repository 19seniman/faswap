const axios = require('axios');
const ethers = require('ethers');
const dotenv = require('dotenv');
const readline = require('readline');
const fs = require('fs');

dotenv.config();

// ABI ERC20 untuk fungsi token umum
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

/**
 * Membangun penyedia JSON RPC fallback dengan logika coba lagi.
 * @param {string[]} rpcUrls - Array URL RPC.
 * @param {number} chainId - ID Rantai.
 * @param {string} name - Nama jaringan.
 * @returns {object} Objek dengan metode getProvider yang mengembalikan penyedia yang berfungsi.
 */
async function buildFallbackProvider(rpcUrls, chainId, name) {
  const provider = new ethers.JsonRpcProvider(rpcUrls[0], { chainId, name });
  return {
    getProvider: async () => {
      // Coba lagi menghubungkan ke RPC hingga 3 kali jika sibuk
      for (let i = 0; i < 3; i++) {
        try {
          await provider.getBlockNumber(); // Uji koneksi
          return provider;
        } catch (e) {
          // Penanganan kesalahan khusus untuk RPC sibuk
          if (e.code === 'UNKNOWN_ERROR' && e.error && e.error.code === -32603) {
            console.log(`${colors.yellow}[⚠] RPC sibuk, mencoba lagi ${i + 1}/3...${colors.reset}`);
            await new Promise(r => setTimeout(r, 2000)); // Tunggu 2 detik sebelum mencoba lagi
            continue;
          }
          throw e; // Lemparkan kesalahan lain
        }
      }
      throw new Error('Semua percobaan RPC gagal'); // Jika semua percobaan gagal
    }
  };
}

// Warna konsol untuk logging yang lebih baik
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m"
};

// Logger kustom untuk output yang konsisten
const logger = {
  info: (msg) => console.log(`${colors.cyan}[i] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[x] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.magenta}[*] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.blue}[>] ${colors.bold}${msg}${colors.reset}`),
  countdown: (msg) => process.stdout.write(`\r${colors.blue}[⏰] ${msg}${colors.reset}`),
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

// Alamat token dan konstanta swap
const TOKENS = {
  PHRS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Ekuivalen token asli untuk DODO
  USDT: '0xD4071393f8716661958F766DF660033b3d35fD29' // USDT di Pharos Testnet
};

const PHAROS_CHAIN_ID = 688688;
const PHAROS_RPC_URLS = ['https://api.zan.top/node/v1/pharos/testnet/bf44f87e170345c0aedef65e9311860d'];
const DODO_ROUTER = '0x73CAfc894dBfC181398264934f7Be4e482fc9d40'; // Alamat router DODO

// Jumlah swap (diuraikan ke BigInt untuk ethers)
const PHRS_TO_USDT_AMOUNT = ethers.parseEther('0.00245'); // 0.00245 PHRS
const USDT_TO_PHRS_AMOUNT = ethers.parseUnits('1', 6); // 1 USDT (USDT memiliki 6 desimal)

// Agen pengguna untuk permintaan HTTP untuk meniru perilaku browser
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0'
];

/**
 * Mendapatkan agen pengguna acak dari daftar.
 * @returns {string} String agen pengguna acak.
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Memuat kunci pribadi dari variabel lingkungan (PRIVATE_KEY_1, PRIVATE_KEY_2, dll.).
 * @returns {string[]} Array kunci pribadi yang valid.
 */
function loadPrivateKeys() {
  const keys = [];
  let i = 1;
  while (process.env[`PRIVATE_KEY_${i}`]) {
    const pk = process.env[`PRIVATE_KEY_${i}`];
    // Validasi dasar untuk format kunci pribadi
    if (pk.startsWith('0x') && pk.length === 66) {
      keys.push(pk);
    } else {
      logger.warn(`Kunci pribadi tidak valid PRIVATE_KEY_${i} di .env, dilewati...`);
    }
    i++;
  }
  return keys;
}

/**
 * Mengambil data dari URL dengan batas waktu yang ditentukan.
 * @param {string} url - URL yang akan diambil.
 * @param {number} timeout - Batas waktu dalam milidetik.
 * @returns {Promise<axios.AxiosResponse>} Respons Axios.
 * @throws {Error} Jika terjadi batas waktu atau kesalahan jaringan.
 */
async function fetchWithTimeout(url, timeout = 15000) {
  try {
    const source = axios.CancelToken.source();
    // Atur batas waktu untuk membatalkan permintaan
    const timeoutId = setTimeout(() => source.cancel('Batas waktu tercapai'), timeout);
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
        'Referer': 'https://faroswap.xyz/', // Header Referer
        'User-Agent': getRandomUserAgent() // Agen pengguna acak
      }
    });
    clearTimeout(timeoutId); // Hapus batas waktu jika permintaan selesai
    return res;
  } catch (err) {
    throw new Error('Batas waktu atau kesalahan jaringan');
  }
}

/**
 * Mengambil data rute DODO secara tangguh dengan beberapa percobaan ulang.
 * @param {string} url - URL API DODO.
 * @returns {Promise<object>} Data respons API DODO.
 * @throws {Error} Jika API DODO gagal secara permanen.
 */
async function robustFetchDodoRoute(url) {
  for (let i = 0; i < 5; i++) { // Coba lagi hingga 5 kali
    try {
      const res = await fetchWithTimeout(url);
      const data = res.data;
      if (data.status !== -1) return data; // Berhasil jika status bukan -1
      logger.warn(`Coba lagi ${i + 1} status API DODO -1`);
    } catch (e) {
      logger.warn(`Coba lagi ${i + 1} gagal: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // Tunggu 2 detik sebelum mencoba lagi
  }
  throw new Error('API DODO gagal secara permanen'); // Jika semua percobaan gagal
}

/**
 * Mengambil rute swap DODO.
 * @param {string} fromAddr - Alamat token untuk ditukar dari.
 * @param {string} toAddr - Alamat token untuk ditukar ke.
 * @param {string} userAddr - Alamat dompet pengguna.
 * @param {bigint} amountWei - Jumlah yang akan ditukar dalam wei.
 * @returns {Promise<object>} Data rute DODO.
 * @throws {Error} Jika pengambilan API DODO gagal.
 */
async function fetchDodoRoute(fromAddr, toAddr, userAddr, amountWei) {
  const deadline = Math.floor(Date.now() / 1000) + 600; // Batas waktu 10 menit
  const url = `https://api.dodoex.io/route-service/v2/widget/getdodoroute?chainId=${PHAROS_CHAIN_ID}&deadLine=${deadline}&apikey=a37546505892e1a952&slippage=3.225&source=dodoV2AndMixWasm&toTokenAddress=${toAddr}&fromTokenAddress=${fromAddr}&userAddr=${userAddr}&estimateGas=true&fromAmount=${amountWei}`;
  try {
    const result = await robustFetchDodoRoute(url);
    // Validasi struktur respons
    if (!result.data || !result.data.data) {
      throw new Error('Respons API DODO tidak valid: bidang data hilang');
    }
    logger.success('Info Rute DODO berhasil diambil');
    return result.data;
  } catch (err) {
    logger.error(`Pengambilan API DODO gagal: ${err.message}`);
    throw err;
  }
}

/**
 * Menyetujui token untuk dibelanjakan oleh router DODO.
 * @param {ethers.Wallet} wallet - Dompet yang akan digunakan untuk persetujuan.
 * @param {string} tokenAddr - Alamat token yang akan disetujui.
 * @param {bigint} amount - Jumlah yang akan disetujui.
 * @returns {Promise<boolean>} True jika persetujuan berhasil atau sudah ada, false jika tidak.
 */
async function approveToken(wallet, tokenAddr, amount) {
  // Token asli (PHRS) tidak memerlukan persetujuan
  if (tokenAddr === TOKENS.PHRS) return true;

  const contract = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  try {
    // Periksa saldo
    const balance = await contract.balanceOf(wallet.address);
    if (balance < amount) {
      logger.error(`Saldo USDT tidak mencukupi: ${ethers.formatUnits(balance, 6)} USDT`);
      return false;
    }

    // Periksa tunjangan saat ini
    const allowance = await contract.allowance(wallet.address, DODO_ROUTER);
    if (allowance >= amount) {
      logger.info('Token sudah disetujui');
      return true;
    }

    // Setujui token
    logger.step(`Menyetujui ${ethers.formatUnits(amount, 6)} USDT untuk router DODO`);
    const tx = await contract.approve(DODO_ROUTER, amount);
    logger.success(`TX Persetujuan dikirim: ${tx.hash}`);
    await tx.wait(); // Tunggu konfirmasi transaksi
    logger.success('Persetujuan dikonfirmasi');
    return true;
  } catch (e) {
    logger.error(`Persetujuan gagal: ${e.message}`);
    return false;
  }
}

/**
 * Mengeksekusi transaksi swap.
 * @param {ethers.Wallet} wallet - Dompet yang akan digunakan untuk swap.
 * @param {object} routeData - Data rute DODO yang berisi detail transaksi.
 * @param {string} fromAddr - Alamat token yang ditukar dari.
 * @param {bigint} amount - Jumlah token yang ditukar.
 * @throws {Error} Jika persetujuan token gagal atau transaksi swap gagal.
 */
async function executeSwap(wallet, routeData, fromAddr, amount) {
  // Setujui token jika bukan token asli
  if (fromAddr !== TOKENS.PHRS) {
    const approved = await approveToken(wallet, fromAddr, amount);
    if (!approved) throw new Error('Persetujuan token gagal');
  }

  try {
    // Validasi data rute untuk transaksi
    if (!routeData.data || routeData.data === '0x') {
      throw new Error('Data transaksi tidak valid dari API DODO');
    }

    // Kirim transaksi swap
    const tx = await wallet.sendTransaction({
      to: routeData.to,
      data: routeData.data,
      value: BigInt(routeData.value), // Nilai untuk transfer token asli
      gasLimit: BigInt(routeData.gasLimit || 500000) // Gunakan gasLimit dari routeData atau default
    });
    logger.success(`Transaksi Swap dikirim! Hash TX: ${tx.hash}`);
    await tx.wait(); // Tunggu konfirmasi transaksi
    logger.success('Transaksi dikonfirmasi!');
  } catch (e) {
    logger.error(`TX Swap gagal: ${e.message}`);
    throw e;
  }
}

/**
 * Melakukan batch swap PHRS-USDT dan USDT-PHRS secara bergantian.
 * @param {ethers.Wallet} wallet - Dompet yang akan digunakan untuk swap.
 * @param {number} count - Jumlah swap yang akan dilakukan.
 */
async function batchSwap(wallet, count) {
  const swaps = [];
  // Siapkan pasangan swap (bergantian PHRS->USDT dan USDT->PHRS)
  for (let i = 0; i < count; i++) {
    swaps.push(i % 2 === 0 ?
      { from: TOKENS.PHRS, to: TOKENS.USDT, amount: PHRS_TO_USDT_AMOUNT, decimals: 18 } :
      { from: TOKENS.USDT, to: TOKENS.PHRS, amount: USDT_TO_PHRS_AMOUNT, decimals: 6 }
    );
  }

  // Jalankan setiap swap dalam batch
  for (let i = 0; i < swaps.length; i++) {
    const { from, to, amount, decimals } = swaps[i];
    const pair = from === TOKENS.PHRS ? 'PHRS -> USDT' : 'USDT -> PHRS';
    logger.step(`Swap #${i + 1} dari ${count}: ${pair}`);
    try {
      const data = await fetchDodoRoute(from, to, wallet.address, amount);
      await executeSwap(wallet, data, from, amount);
    } catch (e) {
      logger.error(`Swap #${i + 1} gagal: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // Penundaan singkat antar swap
  }
}

/**
 * Menjeda eksekusi untuk durasi tertentu dan menampilkan hitungan mundur.
 * @param {number} ms - Durasi tidur dalam milidetik.
 */
async function sleepWithCountdown(ms) {
  return new Promise(resolve => {
    let remaining = ms;
    const interval = setInterval(() => {
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      logger.countdown(`${hours}j ${minutes}m ${seconds}d`); // Pesan hitungan mundur yang lebih ringkas

      remaining -= 1000;
      if (remaining <= 0) {
        clearInterval(interval);
        process.stdout.write('\n'); // Baris baru setelah hitungan mundur selesai
        resolve();
      }
    }, 1000);
  });
}

// Siapkan antarmuka readline untuk input pengguna
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Fungsi pertanyaan readline yang di-promisify.
 * @param {string} query - Pertanyaan yang akan diajukan kepada pengguna.
 * @returns {Promise<string>} Input pengguna.
 */
function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Blok eksekusi utama
(async () => {
  logger.banner(); // Tampilkan banner

  // Bangun dan dapatkan penyedia RPC
  const fallbackProvider = await buildFallbackProvider(PHAROS_RPC_URLS, PHAROS_CHAIN_ID, 'pharos');
  const provider = await fallbackProvider.getProvider();

  // Muat kunci pribadi dari .env
  const privateKeys = loadPrivateKeys();

  if (privateKeys.length === 0) {
    logger.error('Tidak ada kunci pribadi yang valid ditemukan di .env. Harap atur PRIVATE_KEY_1, PRIVATE_KEY_2, dll.');
    process.exit(1);
  }

  try {
    // Gunakan kunci pribadi pertama untuk dompet
    const wallet = new ethers.Wallet(privateKeys[0], provider);
    logger.success(`Dompet dimuat: ${wallet.address}`);

    // Loop utama untuk siklus swap harian
    while (true) {
      const count = await question(`${colors.cyan}Berapa banyak swap yang akan dilakukan (PHRS-USDT/USDT-PHRS)? ${colors.reset}`);
      try {
        const countNum = parseInt(count);
        if (isNaN(countNum) || countNum < 1) {
          throw new Error('Jumlah swap tidak valid. Harap masukkan angka positif.');
        }

        logger.loading(`Memulai ${countNum} swap untuk dompet ${wallet.address}...`);
        await batchSwap(wallet, countNum); // Lakukan batch swap
        logger.success('Siklus swap selesai!');

        logger.step('Menunggu siklus 24 jam berikutnya...');
        // Tunggu 24 jam (24 jam * 60 menit/jam * 60 detik/menit * 1000 milidetik/detik)
        await sleepWithCountdown(24 * 60 * 60 * 1000);
        logger.info('Memulai siklus swap baru.');
      } catch (e) {
        logger.error(`Kesalahan selama siklus swap: ${e.message}`);
        // Jika terjadi kesalahan, tunggu 1 menit sebelum meminta input lagi
        logger.step('Terjadi kesalahan. Menunggu 60 detik sebelum mencoba lagi...');
        await sleepWithCountdown(60 * 1000);
      }
    }
  } catch (err) {
    logger.critical(`Kesalahan kritis selama pengaturan dompet atau loop utama: ${err.message}`);
    process.exit(1); // Keluar jika terjadi kesalahan kritis
  } finally {
    rl.close(); // Tutup antarmuka readline saat selesai
  }
})();
