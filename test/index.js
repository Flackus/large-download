'use strict';
const fs = require('fs');
const path = require('path');
const proxyquire = require('proxyquire').noCallThru();
const server = require('./fixtures/server');

const DEFAULT_PARAMS = {
    link: 'localhost:',
    destination: path.resolve(__dirname, 'fixtures/temp'),
};

function mkParams(extra) {
    return Object.assign({}, DEFAULT_PARAMS, extra);
}

describe('LargeDownload', () => {
    const sandbox = sinon.sandbox.create();

    let testPort;

    let terminateSpy;
    let tickSpy;
    let ProgressBarStub;
    let LargeDownload;

    before(() => {
        return server.start().then(port => {
            testPort = port;
            DEFAULT_PARAMS.link += port;
        });
    });
    after(() => {
        return server.stop();
    });

    beforeEach(() => {
        terminateSpy = sandbox.spy();
        tickSpy = sandbox.spy();
        ProgressBarStub = sandbox.stub().returns({
            terminate: terminateSpy,
            tick: tickSpy,
        });
        LargeDownload = proxyquire('../index', {
            'progress': ProgressBarStub,
        });
    });

    afterEach(() => {
        sandbox.restore();
        fs.existsSync(DEFAULT_PARAMS.destination) && fs.unlinkSync(DEFAULT_PARAMS.destination);
    });

    describe('configuration', () => {
        it('should throw if link is not provided', () => {
            /* eslint no-new: 0 */
            assert.throws(() => {
                new LargeDownload(mkParams({ link: null }));
            }, 'Download link is not provided');
        });

        it('should throw if destination is not provided', () => {
            /* eslint no-new: 0 */
            assert.throws(() => {
                new LargeDownload(mkParams({ destination: null }));
            }, 'Destination is not provided');
        });

        it('should initialize with default values', () => {
            const download = new LargeDownload(mkParams());

            assert.strictEqual(download.timeout, 20000);
            assert.strictEqual(download.retries, 1);
            assert.deepEqual(download.httpOptions, { retries: 0 });
            assert.isUndefined(download.onRetry);
            assert.strictEqual(download.minSizeToShowProgress, 0);
        });

        it('should respect overridden values', () => {
            const httpOptions = {
                timeout: 2000,
                headers: { 'x-ololo': 'trololo' },
                retries: 3,
            };
            const download = new LargeDownload(mkParams({
                timeout: 300000,
                retries: 3,
                httpOptions,
                onRetry: () => {},
                minSizeToShowProgress: Infinity,
            }));

            assert.strictEqual(download.timeout, 300000);
            assert.strictEqual(download.retries, 3);
            assert.deepEqual(download.httpOptions, httpOptions);
            assert.isFunction(download.onRetry);
            assert.strictEqual(download.minSizeToShowProgress, Infinity);
        });
    });

    describe('retries', () => {
        it('should do one retry by default', async () => {
            const originalError = 'Response code 404 (Not Found)';
            const onRetrySpy = sandbox.spy();
            const download = new LargeDownload(mkParams({
                link: DEFAULT_PARAMS.link + '/404',
                onRetry: onRetrySpy,
            }));

            const loadPromise = download.load();
            await assert.isRejected(loadPromise);

            return loadPromise.catch(e => {
                assert.equal(e.message,
                    `Could not download localhost:${testPort}/404 in 2 attempts:\n${originalError}`);
                assert.calledOnce(onRetrySpy);
                assert.equal(onRetrySpy.firstCall.args[0].message, originalError);
            });
        });

        it('should disable retries when zero number of retries is set', async () => {
            const originalError = 'Response code 404 (Not Found)';
            const onRetrySpy = sandbox.spy();
            const download = new LargeDownload(mkParams({
                link: DEFAULT_PARAMS.link + '/404',
                onRetry: onRetrySpy,
                retries: 0,
            }));

            const loadPromise = download.load();
            await assert.isRejected(loadPromise);

            return loadPromise.catch(e => {
                assert.equal(e.message,
                    `Could not download localhost:${testPort}/404 in 1 attempts:\n${originalError}`);
                assert.notCalled(onRetrySpy);
            });
        });

        it('should do provided amount of retries', async () => {
            const originalError = 'Response code 404 (Not Found)';
            const onRetrySpy = sandbox.spy();
            const download = new LargeDownload(mkParams({
                link: DEFAULT_PARAMS.link + '/404',
                onRetry: onRetrySpy,
                retries: 3,
            }));

            const loadPromise = download.load();
            await assert.isRejected(loadPromise);

            return loadPromise.catch(e => {
                assert.equal(e.message,
                    `Could not download localhost:${testPort}/404 in 4 attempts:\n${originalError}`);
                assert.calledThrice(onRetrySpy);
                assert.equal(onRetrySpy.firstCall.args[0].message, originalError);
                assert.equal(onRetrySpy.secondCall.args[0].message, originalError);
                assert.equal(onRetrySpy.thirdCall.args[0].message, originalError);
            });
        });
    });

    describe('various errors should be raised', () => {
        it('network error', () => {
            const download = new LargeDownload(mkParams({
                link: DEFAULT_PARAMS.link + '/404',
                retries: 0,
            }));

            return assert.isRejected(download.load(),
                new RegExp(`Could not download localhost:${testPort}/404[^]*Response code 404 \\(Not Found\\)`));
        });

        it('download timeout', () => {
            const download = new LargeDownload(mkParams({
                link: DEFAULT_PARAMS.link + '/slow',
                timeout: 500,
                retries: 0,
            }));

            return assert.isRejected(download.load(),
                new RegExp(`Could not download localhost:${testPort}/slow[^]*Download timeout \\(500\\) reached`));
        });

        it('size of downloaded file differs from the expected', () => {
            const download = new LargeDownload(mkParams({
                link: DEFAULT_PARAMS.link + '/size-mismatch',
                retries: 0,
            }));

            return assert.isRejected(download.load(),
                new RegExp(`Could not download localhost:${testPort}/size-mismatch[^]*doesn't match "content-length" header`));
        });
    });

    describe('progress bar', () => {
        const origValue = process.stdout.isTTY;

        afterEach(() => {
            process.stdout.isTTY = origValue;
        });

        it('should create and terminate progress bar by default', () => {
            process.stdout.isTTY = true;

            const download = new LargeDownload(mkParams());

            return download.load().then(() => {
                assert.calledOnce(ProgressBarStub);
                assert.called(tickSpy);
                assert.calledOnce(terminateSpy);
            });
        });

        it('should not create progress bar if the response size is smaller than the provided minimum', () => {
            process.stdout.isTTY = true;

            const download = new LargeDownload(mkParams({
                minSizeToShowProgress: Infinity,
            }));

            return download.load().then(() => {
                assert.notCalled(ProgressBarStub);
                assert.notCalled(tickSpy);
                assert.notCalled(terminateSpy);
            });
        });

        it('should not create progress bar if output is not a terminal', () => {
            process.stdout.isTTY = false;

            const download = new LargeDownload(mkParams());

            return download.load().then(() => {
                assert.notCalled(ProgressBarStub);
                assert.notCalled(tickSpy);
                assert.notCalled(terminateSpy);
            });
        });
    });
});
