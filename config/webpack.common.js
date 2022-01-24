const CopyWebpackPlugin = require('copy-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCSSExtractPlugin = require('mini-css-extract-plugin')
const path = require('path')

module.exports = {
    entry: path.resolve(__dirname, '../src/scripts/app.js'),
    output:
    {
        filename: 'bundle.[contenthash].js',
        path: path.resolve(__dirname, '../dist')
    },
    devtool: 'source-map',
    plugins:
    [
        new CopyWebpackPlugin({
            patterns: [
                { from: path.resolve(__dirname, '../static/'), to: "static/" }
                //{ from: path.resolve(__dirname, '../static/nft/'), to: "static/nft/" },
                //{ from: path.resolve(__dirname, '../static/favicon/'), to: "/" }
            ]
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, '../src/index.html'),
            favicon: path.resolve(__dirname, '../static/favicon/favicon.ico'),
            minify: false
        }),
        new MiniCSSExtractPlugin()
    ],
    resolve: {
        fallback: 
        {
            crypto: require.resolve("crypto-browserify"),
            buffer: require.resolve("buffer"),
            stream: require.resolve("stream-browserify"),
            fs: false
        },
    },
    module:
    {
        rules:
        [
            // HTML
            {
                test: /\.(html)$/,
                use: ['html-loader']
            },

            // JS
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use:
                [
                    {
                        loader: 'babel-loader',
                        options: {
                            configFile: path.resolve(__dirname, '.babelrc')
                        }
                    }
                ]
            },

            // CSS
            {
                test: /\.css$/,
                use:
                [
                    MiniCSSExtractPlugin.loader,
                    'css-loader'
                ]
            },

            // Images
            /*{
                test: /\.(jpg|png|gif|svg)$/,
                use:
                [
                    {
                        loader: 'file-loader',
                        options:
                        {
                            outputPath: 'assets/images/'
                        }
                    }
                ]
            },*/

            // Fonts
            {
                test: /\.(ttf|eot|woff|woff2)$/,
                use:
                [
                    {
                        loader: 'file-loader',
                        options:
                        {
                            outputPath: 'assets/fonts/'
                        }
                    }
                ]
            },

            //WASM
            /*{
                test: /\.wasm$/,
                mimetype: 'application/wasm',
                type: 'webassembly/async',
                use:
                [
                    {
                        loader: "file-loader",
                        options: 
                        {
                            //publicPath: path.resolve(__dirname, '/assets/'),
                            outputPath: "assets/"
                        }
                    }
                ]
            }*/
        ]
    }
}