
module.exports = {
  reactStrictMode: true,
  // webpack(config: any) {
  //   config.module.rules.unshift({
  //     test: /\.[jt]sx?$/,
  //     exclude: /node_modules/,
  //     enforce: "pre",
  //     use: [
  //       {
  //         loader: "@deshlo/loader",
  //         options: {
  //           attributeName: "data-src-loc",
  //           wrapLooseTextNodes: true,
  //           annotateLeafNodesOnly: true,
  //         },
  //       },
  //     ],
  //   });
  //   return config
  // },
  turbopack: {
    rules: {
      "*": {
        condition: {
          all: [
            { not: "foreign" },
            { path: /\.(?:[tj]sx?)$/ }, // .js .jsx .ts .tsx
          ],
        },
        loaders: ["@deshlo/loader"],
      },
    },
  }
};
