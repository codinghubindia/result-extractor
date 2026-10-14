import { ValidationError } from './errors.js';

const USN_PATTERN = /^([A-Z0-9]+?)(\d+)$/i;
const DEFAULT_MAX_RANGE_LIMIT = 500;

/**
 * Validates and extracts prefix and numeric components of a USN.
 * @param {string} usn Input USN (e.g., '1GA23IS001')
 * @returns {{ raw: string, prefix: string, num: number, padLength: number, formatted: string }}
 */
export function parseUsn(usn) {
    if (!usn || typeof usn !== 'string') {
        throw new ValidationError('USN must be a non-empty string', { usn });
    }

    const trimmed = usn.trim().toUpperCase();
    const match = trimmed.match(USN_PATTERN);

    if (!match) {
        throw new ValidationError(
            `Invalid USN format '${trimmed}'. Expected prefix followed by numeric digits (e.g., 1GA23IS001).`,
            { usn: trimmed }
        );
    }

    const prefix = match[1];
    const numStr = match[2];
    const num = parseInt(numStr, 10);
    const padLength = numStr.length;

    return {
        raw: trimmed,
        prefix,
        num,
        padLength,
        formatted: `${prefix}${String(num).padStart(padLength, '0')}`,
    };
}

/**
 * Checks whether a given string is a syntactically valid USN.
 * @param {string} usn
 * @returns {boolean}
 */
export function isValidUsn(usn) {
    if (!usn || typeof usn !== 'string') return false;
    return USN_PATTERN.test(usn.trim());
}

/**
 * Sanitizes and normalizes a USN to uppercase and trimmed format.
 * @param {string} usn
 * @returns {string}
 */
export function normalizeUsn(usn) {
    return (usn || '').toString().trim().toUpperCase();
}

/**
 * Generates a contiguous array of zero-padded USNs from start to end inclusive.
 * 
 * @param {string} fromUsn Starting USN (e.g. '1GA23IS001')
 * @param {string} toUsn Ending USN (e.g. '1GA23IS080')
 * @param {object} [options={}] Configuration options
 * @param {number} [options.maxLimit=500] Maximum allowed count of generated USNs
 * @param {boolean} [options.allowDifferentPrefixes=false] Whether mismatched prefixes are accepted
 * @returns {string[]} Array of formatted USN strings
 */
export function generateUsnRange(fromUsn, toUsn, options = {}) {
    const maxLimit = options.maxLimit || DEFAULT_MAX_RANGE_LIMIT;
    const allowDifferentPrefixes = options.allowDifferentPrefixes ?? false;

    const start = parseUsn(fromUsn);
    const end = parseUsn(toUsn);

    if (!allowDifferentPrefixes && start.prefix !== end.prefix) {
        throw new ValidationError(
            `Prefix mismatch: start USN prefix '${start.prefix}' does not match end USN prefix '${end.prefix}'.`,
            { fromUsn: start.raw, toUsn: end.raw, startPrefix: start.prefix, endPrefix: end.prefix }
        );
    }

    if (start.num > end.num) {
        throw new ValidationError(
            `Start USN number (${start.num}) cannot be greater than end USN number (${end.num}).`,
            { fromUsn: start.raw, toUsn: end.raw }
        );
    }

    const count = end.num - start.num + 1;
    if (count > maxLimit) {
        throw new ValidationError(
            `Requested range of ${count} USNs exceeds the maximum permitted limit of ${maxLimit}.`,
            { count, maxLimit, fromUsn: start.raw, toUsn: end.raw }
        );
    }

    const padLength = Math.max(start.padLength, end.padLength, String(end.num).length);
    const usnList = [];

    for (let currentNum = start.num; currentNum <= end.num; currentNum++) {
        const paddedSuffix = String(currentNum).padStart(padLength, '0');
        usnList.push(`${start.prefix}${paddedSuffix}`);
    }

    return usnList;
}

/**
 * Resolves an input payload containing either a range (fromUsn/toUsn) or a list of USNs.
 * Deduplicates and returns an array of valid USN strings.
 * 
 * @param {object} payload
 * @param {string} [payload.fromUsn] Starting USN
 * @param {string} [payload.toUsn] Ending USN
 * @param {string[]|string} [payload.usnList] Explicit array or comma/newline separated string
 * @param {object} [options={}]
 * @returns {string[]} Validated, unique list of USNs
 */
export function parseUsnInput(payload = {}, options = {}) {
    const { fromUsn, toUsn, usnList } = payload;

    if (fromUsn && toUsn) {
        return generateUsnRange(fromUsn, toUsn, options);
    }

    if (usnList) {
        let items = [];
        if (Array.isArray(usnList)) {
            items = usnList;
        } else if (typeof usnList === 'string') {
            items = usnList.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
        }

        const validUsns = items
            .map((u) => normalizeUsn(u))
            .filter((u) => isValidUsn(u));

        const unique = Array.from(new Set(validUsns));
        if (unique.length === 0) {
            throw new ValidationError('Provided usnList contains no valid USN entries.', { usnList });
        }

        const maxLimit = options.maxLimit || DEFAULT_MAX_RANGE_LIMIT;
        if (unique.length > maxLimit) {
            throw new ValidationError(
                `Provided list of ${unique.length} USNs exceeds limit of ${maxLimit}.`,
                { count: unique.length, maxLimit }
            );
        }

        return unique;
    }

    if (fromUsn && !toUsn) {
        return [normalizeUsn(fromUsn)];
    }

    throw new ValidationError(
        'Either both fromUsn and toUsn, or an array/list of USNs in usnList must be provided.',
        { payload }
    );
}
