'use strict';
const fs = require('fs');
const got = require('got');
const ProgressBar = require('progress');

class LargeDownload {
    /**
     * @typedef {Object} HTTPOptions
     * @see https://www.npmjs.com/package/got
     * @property {Number} [retries=0] number of retries to establish the connection
     *    It doesn't mix well with download retries, so default value is set to disable network retries
     *    All other properties work as expected
     */

    /**
     * @typedef  {Object} LargeDownloadOptions
     * @property {String} link download url
     * @property {String} destination where to write the result
     * @property {Number} [timeout] timeout in milliseconds for the download
     * @property {Number} [retries=1] max retries for the whole operation
     * @property {HTTPOptions} [httpOptions]
     * @property {Function} [onRetry] will be called for each retry occured with an Error as the only argument
     * @property {Number} [minSizeToShowProgress=0] minumum file size in bytes to show progress bar
     */

    /**
     * @param {LargeDownloadOptions} opts
     */
    constructor(opts) {
        if ( ! opts.link) {
            throw new Error('Download link is not provided');
        }
        if ( ! opts.destination) {
            throw new Error('Destination is not provided');
        }

        this.link = opts.link;
        this.destination = opts.destination;
        this.timeout = opts.timeout;
        this.retries = opts.hasOwnProperty('retries') ? opts.retries : 1;
        this.httpOptions = Object.assign({ retries: 0 }, opts.httpOptions);
        this.onRetry = opts.onRetry;
        this.minSizeToShowProgress = opts.minSizeToShowProgress || 0;
    }

    /**
     * @returns {Promise}
     */
    load() {
        const _this = this;

        return new Promise((resolve, reject) => {
            let retriesDone = 0;

            function tryDownload() {
                let downloadTimer;
                let bar;
                let declaredSize = 0;
                let downloadedSize = 0;

                const readable = got.stream(_this.link, _this.httpOptions);
                const writable = fs.createWriteStream(_this.destination);

                function cleanup() {
                    // Ensure no more data is written to destination file
                    readable.unpipe(writable);
                    writable.removeListener('finish', onFinish);
                    // Writable stream should be closed manually in case of unpipe.
                    // It is OK to call `end` several times
                    writable.end();

                    downloadTimer && clearTimeout(downloadTimer);
                    bar && bar.terminate();
                }

                function onError(err) {
                    cleanup();

                    if (++retriesDone <= _this.retries) {
                        typeof _this.onRetry === 'function' && _this.onRetry(err);
                        writable.on('close', tryDownload);
                    } else {
                        reject(new Error(
                            `Could not download ${_this.link} in ${retriesDone} attempts:\n${err.message}`));
                    }
                }

                function onFinish() {
                    // It's frequent for a large download to fail due to the server closing connection prematurely
                    if (declaredSize && declaredSize !== downloadedSize) {
                        return onError(new Error(
                            `Downloaded file size (${downloadedSize}) doesn't match "content-length" ` +
                            `header (${declaredSize}) in the server response`));
                    }

                    cleanup();
                    // Resolve only after file has been closed
                    writable.on('close', resolve);
                }

                readable.on('error', e => onError(e));
                writable.on('error', e => onError(e));

                if (_this.timeout) {
                    readable.on('request', req => {
                        downloadTimer = setTimeout(() => {
                            req.abort();
                            onError(new Error(`Download timeout (${_this.timeout}) reached`));
                        }, _this.timeout);
                    });
                }

                readable.on('response', res => {
                    declaredSize = parseInt(res.headers['content-length'], 10);

                    // "progress" module actually checks for redirected output, but still prints empty newlines
                    const doShowProgressBar = process.stdout.isTTY && declaredSize > _this.minSizeToShowProgress;

                    if (doShowProgressBar) {
                        bar = new ProgressBar('[:bar] :percent :etas', {
                            complete: '=',
                            incomplete: ' ',
                            width: 30,
                            total: declaredSize,
                        });
                    }

                    res.on('data', chunk => {
                        const len = chunk.length;

                        downloadedSize += len;
                        doShowProgressBar && bar.tick(len);
                    });
                });

                writable.on('finish', onFinish);

                readable.pipe(writable);
            }

            tryDownload();
        });
    }
}

module.exports = LargeDownload;
