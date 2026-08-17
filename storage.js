/**
 * Persistence layer for the two JSON documents the app keeps:
 *   - swaps.json    -> day overrides   { [dateKey]: { status, pairedWith } }
 *   - settings.json -> { password, sessionSecret }
 *
 * Two interchangeable backends:
 *   local      - flat files under DATA_DIR (default; what docker compose uses)
 *   azure-blob - block blobs in an Azure Storage container (for Azure hosting,
 *                where the container filesystem is ephemeral)
 *
 * The backend is chosen by STORAGE_BACKEND, or inferred: if Azure Storage
 * credentials are present, azure-blob is used, otherwise local.
 *
 * Documents are cached in memory after init() so the rest of the app can keep
 * reading them synchronously (one blob round-trip per request would be silly
 * for a single-user tool). Writes are write-through: cache first, then persist.
 *
 * IMPORTANT: because of that cache, run at most ONE replica when using
 * azure-blob. Two instances would each hold their own copy and clobber each
 * other's writes. The Terraform config pins max_replicas = 1.
 *
 * As a safety net for the one case that can still overlap two instances - a
 * Container Apps revision rollout briefly runs old and new together - blob
 * writes use optimistic concurrency (If-Match on the ETag we last read). A
 * stale writer then fails loudly instead of silently overwriting newer data.
 * See DEPLOY-AZURE.md.
 */

const fs = require('fs');
const path = require('path');

const SWAPS_DOC = 'swaps.json';
const SETTINGS_DOC = 'settings.json';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ---- Azure Storage configuration (see .env.example) ----
const AZURE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const AZURE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME || '';
const AZURE_ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY || '';
// The specific blob container both documents live in.
const AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER || 'schedule-data';

function hasAzureCredentials() {
    return Boolean(AZURE_CONNECTION_STRING || (AZURE_ACCOUNT_NAME && AZURE_ACCOUNT_KEY));
}

const backend = (process.env.STORAGE_BACKEND || (hasAzureCredentials() ? 'azure-blob' : 'local')).toLowerCase();

const cache = {
    [SWAPS_DOC]: {},
    [SETTINGS_DOC]: {}
};

// ---------------------------------------------------------------- local files

function localPath(doc) {
    return path.join(DATA_DIR, doc);
}

function localRead(doc) {
    try {
        return JSON.parse(fs.readFileSync(localPath(doc), 'utf8'));
    } catch (err) {
        return {};
    }
}

function localWrite(doc, value) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(localPath(doc), JSON.stringify(value, null, 2));
}

// ----------------------------------------------------------------- azure blob

let containerClient = null;
// Last ETag seen per document, used as the If-Match precondition on write.
const etags = {};

function getContainerClient() {
    if (containerClient) return containerClient;

    // Required lazily so the dependency is never touched in local mode.
    const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');

    let serviceClient;
    if (AZURE_CONNECTION_STRING) {
        serviceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
    } else {
        serviceClient = new BlobServiceClient(
            `https://${AZURE_ACCOUNT_NAME}.blob.core.windows.net`,
            new StorageSharedKeyCredential(AZURE_ACCOUNT_NAME, AZURE_ACCOUNT_KEY)
        );
    }

    containerClient = serviceClient.getContainerClient(AZURE_CONTAINER);
    return containerClient;
}

async function streamToString(readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function blobRead(doc) {
    const blob = getContainerClient().getBlockBlobClient(doc);
    try {
        const response = await blob.download();
        const body = await streamToString(response.readableStreamBody);
        etags[doc] = response.etag;
        return JSON.parse(body);
    } catch (err) {
        if (err.statusCode === 404 || err.code === 'BlobNotFound') {
            delete etags[doc];
            return {};
        }
        throw err;
    }
}

function isPreconditionFailure(err) {
    return err.statusCode === 412 || err.statusCode === 409 ||
        err.code === 'ConditionNotMet' || err.code === 'BlobAlreadyExists';
}

async function blobWrite(doc, value) {
    const body = JSON.stringify(value, null, 2);
    const blob = getContainerClient().getBlockBlobClient(doc);

    // If we have an ETag, require the blob to be untouched since we read it.
    // If we don't, require that it doesn't exist yet. Either way, a concurrent
    // writer causes a precondition failure rather than a lost update.
    const conditions = etags[doc]
        ? { ifMatch: etags[doc] }
        : { ifNoneMatch: '*' };

    try {
        const response = await blob.upload(body, Buffer.byteLength(body), {
            blobHTTPHeaders: { blobContentType: 'application/json' },
            conditions
        });
        etags[doc] = response.etag;
    } catch (err) {
        if (isPreconditionFailure(err)) {
            // Someone else wrote since we last read. Re-sync so the next attempt
            // starts from current data, and surface the conflict.
            cache[doc] = await blobRead(doc);
            const conflict = new Error(
                `Conflict writing ${doc}: it changed in storage since this instance ` +
                'last read it (another replica?). Reloaded latest; retry the change.'
            );
            conflict.conflict = true;
            throw conflict;
        }
        throw err;
    }
}

// -------------------------------------------------------------- public surface

async function init() {
    if (backend === 'azure-blob') {
        if (!hasAzureCredentials()) {
            throw new Error(
                'STORAGE_BACKEND=azure-blob but no credentials found. Set ' +
                'AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT_NAME + ' +
                'AZURE_STORAGE_ACCOUNT_KEY. See .env.example.'
            );
        }
        // Safe to call repeatedly; no-ops when the container already exists.
        await getContainerClient().createIfNotExists();
        cache[SWAPS_DOC] = await blobRead(SWAPS_DOC);
        cache[SETTINGS_DOC] = await blobRead(SETTINGS_DOC);
        console.log(`Storage: azure-blob (container "${AZURE_CONTAINER}")`);
    } else {
        cache[SWAPS_DOC] = localRead(SWAPS_DOC);
        cache[SETTINGS_DOC] = localRead(SETTINGS_DOC);
        console.log(`Storage: local files in ${DATA_DIR}`);
    }
}

// Persist first, then update the cache, so a failed write can't leave the cache
// holding changes that were never stored.
async function write(doc, value) {
    if (backend === 'azure-blob') {
        await blobWrite(doc, value);
    } else {
        localWrite(doc, value);
    }
    cache[doc] = value;
}

function getSwaps() {
    return cache[SWAPS_DOC];
}

async function saveSwaps(value) {
    await write(SWAPS_DOC, value);
}

function getSettings() {
    // Local files are cheap to stat/read, so re-read them: editing
    // data/settings.json by hand then takes effect without a restart, which is
    // how local development works today. Blob mode serves the cached copy.
    if (backend === 'local') {
        cache[SETTINGS_DOC] = localRead(SETTINGS_DOC);
    }
    return cache[SETTINGS_DOC];
}

async function saveSettings(value) {
    await write(SETTINGS_DOC, value);
}

module.exports = {
    backend,
    container: AZURE_CONTAINER,
    dataDir: DATA_DIR,
    init,
    getSwaps,
    saveSwaps,
    getSettings,
    saveSettings
};
