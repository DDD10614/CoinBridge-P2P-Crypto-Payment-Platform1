export type CoinSymbol =
  | 'BTC'
  | 'ETH'
  | 'USDT'
  | 'USDC'
  | 'SOL'
  | 'BNB'
  | 'XRP'
  | 'DOGE'
  | 'TRX'
  | (string & {});

export type MultiCoinNetworkId =
  | 'BITCOIN'
  | 'ETHEREUM_ERC20'
  | 'TRON_TRC20'
  | 'POLYGON'
  | 'BSC'
  | 'SOLANA'
  | 'XRP_LEDGER'
  | 'DOGECOIN';

export interface MultiCoinNetworkMeta {
  id: MultiCoinNetworkId;
  label: string;
  shortLabel: string;
  addressExample: string;
  defaultConfirmations: number;
  explorerBaseUrl: string;
}

export const MULTI_COIN_NETWORKS: Record<MultiCoinNetworkId, MultiCoinNetworkMeta> = {
  BITCOIN: {
    id: 'BITCOIN',
    label: 'Bitcoin Mainnet',
    shortLabel: 'BTC',
    addressExample: 'bc1q...',
    defaultConfirmations: 2,
    explorerBaseUrl: 'https://mempool.space/tx/',
  },
  ETHEREUM_ERC20: {
    id: 'ETHEREUM_ERC20',
    label: 'Ethereum (ERC20)',
    shortLabel: 'ERC20',
    addressExample: '0x...',
    defaultConfirmations: 12,
    explorerBaseUrl: 'https://etherscan.io/tx/',
  },
  TRON_TRC20: {
    id: 'TRON_TRC20',
    label: 'TRON (TRC20)',
    shortLabel: 'TRC20',
    addressExample: 'T...',
    defaultConfirmations: 19,
    explorerBaseUrl: 'https://tronscan.org/#/transaction/',
  },
  POLYGON: {
    id: 'POLYGON',
    label: 'Polygon (PoS)',
    shortLabel: 'Polygon',
    addressExample: '0x...',
    defaultConfirmations: 32,
    explorerBaseUrl: 'https://polygonscan.com/tx/',
  },
  BSC: {
    id: 'BSC',
    label: 'BNB Smart Chain (BEP20)',
    shortLabel: 'BEP20',
    addressExample: '0x...',
    defaultConfirmations: 15,
    explorerBaseUrl: 'https://bscscan.com/tx/',
  },
  SOLANA: {
    id: 'SOLANA',
    label: 'Solana Mainnet',
    shortLabel: 'SPL',
    addressExample: 'So11...',
    defaultConfirmations: 32,
    explorerBaseUrl: 'https://solscan.io/tx/',
  },
  XRP_LEDGER: {
    id: 'XRP_LEDGER',
    label: 'XRP Ledger',
    shortLabel: 'XRPL',
    addressExample: 'r...',
    defaultConfirmations: 1,
    explorerBaseUrl: 'https://xrpscan.com/tx/',
  },
  DOGECOIN: {
    id: 'DOGECOIN',
    label: 'Dogecoin Mainnet',
    shortLabel: 'DOGE',
    addressExample: 'D...',
    defaultConfirmations: 6,
    explorerBaseUrl: 'https://dogechain.info/tx/',
  },
};

export interface CoinNetworkContract {
  network: MultiCoinNetworkId;
  contractAddress: string; // 'NATIVE' for native L1 coins, or exact token contract address
  confirmationsRequired: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
}

export interface SupportedCoinConfig {
  id: string;
  symbol: CoinSymbol;
  name: string;
  coingeckoId: string;
  iconKey: string;
  accentHex: string;
  description: string;
  decimals: number;
  supportedNetworks: MultiCoinNetworkId[];
  networkContracts: CoinNetworkContract[];
  minTradeQuantityE8: number;
  maxTradeQuantityE8: number;
  minOrderInrPaise: number;
  maxOrderInrPaise: number;
  tradingFeeBps: number;
  confirmationsRequired: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  tradingEnabled: boolean;
  custodyApproved: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

export const E8_PER_COIN = 100_000_000;
export const PAISE_PER_INR = 100;

export interface CoinMarketQuote {
  symbol: string;
  coingeckoId: string;
  name: string;
  inrPrice: number | null;
  usdPrice?: number | null;
  change24hPct: number | null;
  volume24hInr: number | null;
  marketCapInr: number | null;
  high24hInr: number | null;
  low24hInr: number | null;
  circulatingSupply?: number | null;
  lastUpdatedAt?: string | null;
  isAvailable?: boolean;
  freshnessStatus?: string;
}

export const DEFAULT_SUPPORTED_COINS: SupportedCoinConfig[] = [
  {
    id: 'USDT',
    symbol: 'USDT',
    name: 'Tether USD',
    coingeckoId: 'tether',
    iconKey: 'usdt',
    accentHex: '#0F9D8A',
    description:
      'USD-pegged stablecoin used as the primary P2P settlement unit across TRON, Ethereum, BSC, and Polygon.',
    decimals: 6,
    supportedNetworks: ['TRON_TRC20', 'POLYGON', 'BSC', 'ETHEREUM_ERC20'],
    networkContracts: [
      {
        network: 'TRON_TRC20',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        confirmationsRequired: 19,
        depositEnabled: true,
        withdrawalEnabled: true,
      },
      {
        network: 'POLYGON',
        contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        confirmationsRequired: 32,
        depositEnabled: true,
        withdrawalEnabled: true,
      },
      {
        network: 'BSC',
        contractAddress: '0x55d398326f99059fF775485246999027B3197955',
        confirmationsRequired: 15,
        depositEnabled: true,
        withdrawalEnabled: true,
      },
      {
        network: 'ETHEREUM_ERC20',
        contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        confirmationsRequired: 12,
        depositEnabled: true,
        withdrawalEnabled: true,
      },
    ],
    minTradeQuantityE8: 10 * E8_PER_COIN,
    maxTradeQuantityE8: 100_000 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 10,
    confirmationsRequired: 19,
    depositEnabled: true,
    withdrawalEnabled: true,
    tradingEnabled: true,
    custodyApproved: true,
    isFeatured: true,
    sortOrder: 1,
  },
  {
    id: 'BTC',
    symbol: 'BTC',
    name: 'Bitcoin',
    coingeckoId: 'bitcoin',
    iconKey: 'btc',
    accentHex: '#F7931A',
    description:
      'Decentralized peer-to-peer digital asset secured by proof-of-work consensus on the Bitcoin network.',
    decimals: 8,
    supportedNetworks: ['BITCOIN', 'BSC'],
    networkContracts: [
      {
        network: 'BITCOIN',
        contractAddress: 'NATIVE',
        confirmationsRequired: 2,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'BSC',
        contractAddress: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
        confirmationsRequired: 15,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 10_000, // 0.0001 BTC
    maxTradeQuantityE8: 5 * E8_PER_COIN,
    minOrderInrPaise: 100_000,
    maxOrderInrPaise: 100_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 2,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: true,
    sortOrder: 2,
  },
  {
    id: 'ETH',
    symbol: 'ETH',
    name: 'Ethereum',
    coingeckoId: 'ethereum',
    iconKey: 'eth',
    accentHex: '#4F6EF7',
    description:
      'Programmable smart-contract blockchain asset powering EVM decentralized applications and settlement.',
    decimals: 8,
    supportedNetworks: ['ETHEREUM_ERC20', 'POLYGON', 'BSC'],
    networkContracts: [
      {
        network: 'ETHEREUM_ERC20',
        contractAddress: 'NATIVE',
        confirmationsRequired: 12,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'POLYGON',
        contractAddress: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        confirmationsRequired: 32,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'BSC',
        contractAddress: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        confirmationsRequired: 15,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 200_000, // 0.002 ETH
    maxTradeQuantityE8: 50 * E8_PER_COIN,
    minOrderInrPaise: 100_000,
    maxOrderInrPaise: 100_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 12,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: true,
    sortOrder: 3,
  },
  {
    id: 'USDC',
    symbol: 'USDC',
    name: 'USD Coin',
    coingeckoId: 'usd-coin',
    iconKey: 'usdc',
    accentHex: '#2775CA',
    description:
      'Fully reserved dollar-denominated stablecoin supporting fast multi-chain settlement across Ethereum, Polygon, and Solana.',
    decimals: 6,
    supportedNetworks: ['ETHEREUM_ERC20', 'POLYGON', 'SOLANA', 'BSC'],
    networkContracts: [
      {
        network: 'ETHEREUM_ERC20',
        contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        confirmationsRequired: 12,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'POLYGON',
        contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        confirmationsRequired: 32,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'SOLANA',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        confirmationsRequired: 32,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'BSC',
        contractAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        confirmationsRequired: 15,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 10 * E8_PER_COIN,
    maxTradeQuantityE8: 100_000 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 10,
    confirmationsRequired: 12,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: true,
    sortOrder: 4,
  },
  {
    id: 'SOL',
    symbol: 'SOL',
    name: 'Solana',
    coingeckoId: 'solana',
    iconKey: 'sol',
    accentHex: '#14F195',
    description:
      'High-throughput Proof-of-History smart-contract layer designed for sub-second finality and low transaction fees.',
    decimals: 8,
    supportedNetworks: ['SOLANA'],
    networkContracts: [
      {
        network: 'SOLANA',
        contractAddress: 'NATIVE',
        confirmationsRequired: 32,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 5_000_000, // 0.05 SOL
    maxTradeQuantityE8: 500 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 32,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: true,
    sortOrder: 5,
  },
  {
    id: 'BNB',
    symbol: 'BNB',
    name: 'BNB',
    coingeckoId: 'binancecoin',
    iconKey: 'bnb',
    accentHex: '#F0B90B',
    description:
      'Native utility and gas token of the BNB Smart Chain ecosystem supporting BEP20 settlement.',
    decimals: 8,
    supportedNetworks: ['BSC', 'ETHEREUM_ERC20'],
    networkContracts: [
      {
        network: 'BSC',
        contractAddress: 'NATIVE',
        confirmationsRequired: 15,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'ETHEREUM_ERC20',
        contractAddress: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52',
        confirmationsRequired: 12,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 1_000_000, // 0.01 BNB
    maxTradeQuantityE8: 250 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 15,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: false,
    sortOrder: 6,
  },
  {
    id: 'XRP',
    symbol: 'XRP',
    name: 'XRP',
    coingeckoId: 'ripple',
    iconKey: 'xrp',
    accentHex: '#1D2939',
    description:
      'Fast cross-border payment settlement token operating natively on the XRP Ledger.',
    decimals: 6,
    supportedNetworks: ['XRP_LEDGER'],
    networkContracts: [
      {
        network: 'XRP_LEDGER',
        contractAddress: 'NATIVE',
        confirmationsRequired: 1,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 5 * E8_PER_COIN,
    maxTradeQuantityE8: 100_000 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 1,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: false,
    sortOrder: 7,
  },
  {
    id: 'DOGE',
    symbol: 'DOGE',
    name: 'Dogecoin',
    coingeckoId: 'dogecoin',
    iconKey: 'doge',
    accentHex: '#C2A633',
    description:
      'Peer-to-peer proof-of-work digital currency derived from Scrypt consensus with low transfer costs.',
    decimals: 8,
    supportedNetworks: ['DOGECOIN', 'BSC'],
    networkContracts: [
      {
        network: 'DOGECOIN',
        contractAddress: 'NATIVE',
        confirmationsRequired: 6,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      {
        network: 'BSC',
        contractAddress: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43',
        confirmationsRequired: 15,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 25 * E8_PER_COIN,
    maxTradeQuantityE8: 500_000 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 6,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: false,
    sortOrder: 8,
  },
  {
    id: 'TRX',
    symbol: 'TRX',
    name: 'TRON',
    coingeckoId: 'tron',
    iconKey: 'trx',
    accentHex: '#EB0029',
    description:
      'Native utility and energy asset of the TRON Delegated Proof-of-Stake blockchain.',
    decimals: 6,
    supportedNetworks: ['TRON_TRC20'],
    networkContracts: [
      {
        network: 'TRON_TRC20',
        contractAddress: 'NATIVE',
        confirmationsRequired: 19,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    ],
    minTradeQuantityE8: 25 * E8_PER_COIN,
    maxTradeQuantityE8: 500_000 * E8_PER_COIN,
    minOrderInrPaise: 50_000,
    maxOrderInrPaise: 50_000_000,
    tradingFeeBps: 15,
    confirmationsRequired: 19,
    depositEnabled: false,
    withdrawalEnabled: false,
    tradingEnabled: false,
    custodyApproved: false,
    isFeatured: false,
    sortOrder: 9,
  },
];

export const DEFAULT_COIN_MAP: Record<string, SupportedCoinConfig> = Object.fromEntries(
  DEFAULT_SUPPORTED_COINS.map((coin) => [coin.symbol, coin])
);

export function normalizeCoinSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCoinSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,12}$/.test(symbol.trim().toUpperCase());
}

export function isValidMultiChainAddress(network: MultiCoinNetworkId | string, address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  switch (network) {
    case 'ETHEREUM_ERC20':
    case 'POLYGON':
    case 'BSC':
      return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
    case 'TRON_TRC20':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed);
    case 'SOLANA':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
    case 'BITCOIN':
      return /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(trimmed);
    case 'XRP_LEDGER':
      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(trimmed);
    case 'DOGECOIN':
      return /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/.test(trimmed);
    default:
      return false;
  }
}

export function isValidContractOrNative(network: MultiCoinNetworkId | string, contract: string): boolean {
  const trimmed = contract.trim();
  if (!trimmed) return false;
  if (trimmed.toUpperCase() === 'NATIVE') return true;
  return isValidMultiChainAddress(network, trimmed);
}

export function formatCoinQuantityFromE8(quantityE8: number, maxDecimals = 6): string {
  const safe = Number.isFinite(quantityE8) ? quantityE8 : 0;
  const units = safe / E8_PER_COIN;
  return units.toLocaleString('en-IN', {
    minimumFractionDigits: units >= 100 ? 2 : 2,
    maximumFractionDigits: units >= 1000 ? 2 : maxDecimals,
  });
}

export function coinUnitsToE8(units: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return Math.round(units * E8_PER_COIN);
}

export function e8ToUsdtMicro(quantityE8: number): number {
  return Math.max(1, Math.round(quantityE8 / 100));
}

export function usdtMicroToE8(usdtMicro: number): number {
  return Math.round(usdtMicro * 100);
}

export function calculateMultiCoinBuyBreakdown(params: {
  inrPaise: number;
  rateInrPaise: number;
  feeBps: number;
}) {
  const inrPaise = Math.max(0, Math.round(params.inrPaise));
  const rateInrPaise = Math.max(1, Math.round(params.rateInrPaise));
  const feeBps = Math.max(0, Math.round(params.feeBps));
  const grossQuantityE8 = Math.round((inrPaise / rateInrPaise) * E8_PER_COIN);
  const feeE8 = Math.round((grossQuantityE8 * feeBps) / 10_000);
  const netQuantityE8 = Math.max(0, grossQuantityE8 - feeE8);
  return {
    inrPaise,
    rateInrPaise,
    grossQuantityE8,
    feeE8,
    netQuantityE8,
  };
}

export function calculateMultiCoinSellBreakdown(params: {
  quantityE8: number;
  rateInrPaise: number;
  feeBps: number;
  tdsBps?: number;
}) {
  const quantityE8 = Math.max(0, Math.round(params.quantityE8));
  const rateInrPaise = Math.max(1, Math.round(params.rateInrPaise));
  const feeBps = Math.max(0, Math.round(params.feeBps));
  const tdsBps = Math.max(0, Math.round(params.tdsBps ?? 100));
  const feeE8 = Math.round((quantityE8 * feeBps) / 10_000);
  const netQuantityE8 = Math.max(0, quantityE8 - feeE8);
  const grossInrPaise = Math.round((netQuantityE8 * rateInrPaise) / E8_PER_COIN);
  const tdsInrPaise = Math.round((grossInrPaise * tdsBps) / 10_000);
  const netInrPaise = Math.max(0, grossInrPaise - tdsInrPaise);
  return {
    quantityE8,
    feeE8,
    netQuantityE8,
    grossInrPaise,
    tdsInrPaise,
    netInrPaise,
  };
}

export function formatCompactInr(inr: number | null | undefined): string {
  if (inr === null || inr === undefined || !Number.isFinite(inr)) return 'Unavailable';
  const abs = Math.abs(inr);
  if (abs >= 1_00_00_00_00_000) return `₹${(inr / 1_00_00_00_00_000).toFixed(2)} L Cr`;
  if (abs >= 1_00_00_000) return `₹${(inr / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `₹${(inr / 1_00_000).toFixed(2)} L`;
  return `₹${inr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatCompactSupply(supply: number | null | undefined, symbol: string): string {
  if (supply === null || supply === undefined || !Number.isFinite(supply)) return 'Unavailable';
  if (supply >= 1_000_000_000) return `${(supply / 1_000_000_000).toFixed(2)}B ${symbol}`;
  if (supply >= 1_000_000) return `${(supply / 1_000_000).toFixed(2)}M ${symbol}`;
  if (supply >= 1_000) return `${(supply / 1_000).toFixed(2)}K ${symbol}`;
  return `${supply.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${symbol}`;
}

export function formatSpotInr(inr: number | null | undefined): string {
  if (inr === null || inr === undefined || !Number.isFinite(inr)) return 'Unavailable';
  if (inr >= 1000) {
    return `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (inr >= 1) {
    return `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  return `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}
