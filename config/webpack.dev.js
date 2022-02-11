import { merge } from 'webpack-merge'
import { commonConfiguration } from './webpack.common.js'

import { internalIpV4Sync } from 'internal-ip'

import { getPort } from 'portfinder-sync'


import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import { resolve as _resolve } from 'path'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const infoColor = (_message) =>
{
    return `\u001b[1m\u001b[34m${_message}\u001b[39m\u001b[22m`
}

export default merge(
    commonConfiguration,
    {
        mode: 'development',
        devServer:
        {
            hot: false,
            liveReload: true,
            //watchFiles: ['src/**/*', 'public/**/*'],


            host: 'localhost', //or '0.0.0.0' //or "local-ip
            port: getPort(3030),
            
            open: {
                app: {
                    name: 'chrome',
                    //arguments: ['--incognito', '--new-window'],
                },    
            },

            https: true,
            //useLocalIp: false,

            //disableHostCheck: true,
            allowedHosts: "all",

            client:
            {
                overlay: true,
            },

            static:
            {
                directory: _resolve(__dirname, "../dist"),
                watch: true,
            },

            //noInfo: true,
            
            devMiddleware:{
                mimeTypes: { 'application/octet-stream': ['dat', 'fset', 'iset', 'fset3'] },
            },

            onAfterSetupMiddleware: function(devServer)
            {
                const port = devServer.options.port
                const https = devServer.options.https ? 's' : ''
                const localIp = internalIpV4Sync()
                const domain1 = `http${https}://${localIp}:${port}`
                const domain2 = `http${https}://localhost:${port}`
                
                console.log(`Project running at:\n  - ${infoColor(domain1)}\n  - ${infoColor(domain2)}`)
            }
        }
    }
)