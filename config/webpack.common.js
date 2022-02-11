//https://github.com/webpack/webpack-cli

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __require = createRequire(import.meta.url);
const __dirname = dirname(__filename);

//const pathName = require.resolve('vue.runtime.esm.js');

import { resolve as _resolve } from 'path'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import MiniCssExtractPlugin from "mini-css-extract-plugin";
const { loader: _loader } = MiniCssExtractPlugin;

export const commonConfiguration = {
    entry : {
        "mylib": _resolve(__dirname, '../src/index.ts')
    },
    output : {
        path: _resolve(__dirname, "../dist"),
        chunkFilename: '[name].js',
        filename: '[name].js'
    },
    devtool : 'source-map',
    plugins : [
        new CopyWebpackPlugin({
            patterns: [
                { from: _resolve(__dirname, '../static/'), to: "static/" }
                //{ from: path.resolve(__dirname, '../static/nft/'), to: "static/nft/" },
                //{ from: path.resolve(__dirname, '../static/favicon/'), to: "/" }
            ]
        }),
        new HtmlWebpackPlugin({
            template: _resolve(__dirname, '../src/index.html'),
            favicon: _resolve(__dirname, '../static/favicon/favicon.ico'),
            minify: false
        }),
        new MiniCssExtractPlugin()
    ],
    resolve : {
        extensions: [".tsx", ".ts", ".js"],
        fallback: {
            crypto: __require.resolve("crypto-browserify"),
            buffer: __require.resolve("buffer"),
            stream: __require.resolve("stream-browserify"),
            fs: false
        },
    },
    module : {
        rules: [
            // HTML
            {
                test: /\.(html)$/,
                use: ['html-loader']
            },
    
            //TS
            {
                test: /\.(ts|tsx)$/i,
                loader: "ts-loader",
                exclude: ["/node_modules/"],
            },
    
            // JS
            // {
            //     test: /\.js$/i,
            //     exclude: ["/node_modules/"],
            //     use:
            //     [
            //         {
            //             loader: 'babel-loader',
            //             options: {
            //                 configFile: path.resolve(__dirname, '.babelrc')
            //             }
            //         }
            //     ]
            // },
            // CSS
            {
                test: /\.css$/i,
                use: [
                    _loader,
                    'css-loader'
                ]
            },
    
            // Images
            /*{
                test: /\.(jpg|png|gif|svg)$/,
                type: "asset",
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
                type: "asset",
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            outputPath: 'assets/fonts/'
                        }
                    }
                ]
            },
        ]
    }
}

