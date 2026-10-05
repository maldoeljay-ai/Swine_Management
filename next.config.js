/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    rules: {
      "**/*.{tsx,jsx}": {
        loaders: [{
          loader: "@locator/webpack-loader",
          options: { env: "development" }
        }]
      }
    }
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.module.rules.push({
        test: /\.(tsx|ts|jsx|js)$/,
        exclude: /node_modules/,
        use: [{
          loader: '@locator/webpack-loader',
          options: { 
            env: 'development'
          }
        }]
      });
    }
    return config;
  }
};

export default nextConfig;
