/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // WalletConnect (pulled in by wagmi's connectors) references optional Node-only packages that
  // are never installed and never run in the browser. Marking them external silences the
  // "Module not found: pino-pretty" warning without changing what ships.
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};
