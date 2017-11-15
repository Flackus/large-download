# large-download

### Usage

```javascript
const LargeDownload = require('large-download');

const download = new LargeDownload({
    link: 'http://example.com',
    destination: './some/path/to/local/file',
    timeout: 300000,
    retries: 3
});

const loadPromise = download.load();
```

See jsdoc for further information.
