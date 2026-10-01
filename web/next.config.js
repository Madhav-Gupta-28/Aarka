/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // WalletConnect (pulled in by wagmi's connectors) references optional Node-only packages that
  // are never installed and never run in the browser. Marking them external silences the
  // "Module not found: pino-pretty" warning without changing what ships.
  // The old pages folded into three: Home, App and How it works. Old links still land somewhere
  // sensible.
  async redirects() {
    return [
      {source: "/markets", destination: "/app", permanent: false},
      {source: "/practice", destination: "/app", permanent: false},
      {source: "/ledger", destination: "/app#positions", permanent: false},
      {source: "/learn", destination: "/how", permanent: false},
      {source: "/sun", destination: "/how#sun", permanent: false},
      {source: "/split/:series/split", destination: "/split/:series?do=split", permanent: false},
      {source: "/split/:series/trade", destination: "/split/:series?do=buy", permanent: false},
    ];
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};
