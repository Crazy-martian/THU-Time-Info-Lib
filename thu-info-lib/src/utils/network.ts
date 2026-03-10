import {CONTENT_TYPE_FORM, CR_TIMETABLE_URL, USER_AGENT} from "../constants/strings";
import iconv from "iconv-lite";
import fetch from "cross-fetch";
import AbortController from "abort-controller";
import { ResponseStatusError } from "./error";

export const cookies: { [key: string]: string } = {};

/**
 * Clear the cookies.
 */
export const clearCookies = () => {
    Object.keys(cookies).forEach((key) => delete cookies[key]);
};

/**
 * Manually set a cookie.
 */
export const setCookie = (key: string, value: string) => {
    cookies[key] = value;

};

const buildCookieHeader = () =>
    Object.keys(cookies)
        .map((key) => `${key}=${cookies[key]}`)
        .join(";");

const buildHeaders = (contentType: string) => {
    const defaultHeaders = {
        "Content-Type": contentType,
        "User-Agent": USER_AGENT,
    };

    return global.FileReader === undefined
        ? {
            ...defaultHeaders,
            Cookie: buildCookieHeader(),
        }
        : defaultHeaders;
};

const updateCookiesFromHeaders = (headers: Headers) => {
    headers.forEach((value: string, key: string) => {
        if (key === "set-cookie") {
            // TODO: check relevant specifications and rewrite this
            if (value.includes("Expires")) {
                const segment = value.split(";")[0];
                const [item, val] = segment.split("=");
                if (item && val) {
                    cookies[item.trim()] = val.trim();
                }
            } else {
                for (const v of value.split(",")) {
                    const segment = v.split(";")[0];
                    const [item, val] = segment.split("=");
                    if (item && val) {
                        cookies[item.trim()] = val.trim();
                    }
                }
            }
        }
    });
};

/**
 * An enhanced implementation of `encodeURIComponent`, which supports
 * arbitrary charset.
 */
export const arbitraryEncode = (s: string, encoding = "UTF-8") =>
    encoding === "UTF-8" ? encodeURIComponent(s) : String(s)
        .split("")
        .map((ch) => RegExp(/^[\u4e00-\u9fa5]*$/).test(ch)
            ? iconv.encode(ch, encoding).reduce((a: string, b: number) => a + "%" + b.toString(16), "")
            : ch,
        )
        .join("");

/**
 * Converts form data into url-encoded format (utf-8).
 */
export const stringify = (form: any, paramEncoding = "UTF-8") =>
    Object.keys(form)
        .map((key) => `${arbitraryEncode(key, paramEncoding)}=${arbitraryEncode(form[key], paramEncoding)}`)
        .join("&");

/**
 * Gets the response data from the given `url`.
 *
 * If param `post` is provided, a `POST` request with the given post form will
 * be sent. Otherwise, a `GET` request will be sent.
 *
 * The `timeout` is `60000` by default, in milliseconds.
 *
 * The `paramEncoding` is `UTF-8` by default, used to encode post form params.
 *
 * If `serialized` is `true`, the method will treat `post` as a string that has
 * already been serialized.
 */
export const uFetch = async (
    url: string,
    post?: object,
    timeout = 60000,
    paramEncoding = "UTF-8",
    serialized = false,
    requestContentType = CONTENT_TYPE_FORM,
): Promise<string> => {
    // Handle timeout abortion
    const controller = new AbortController();
    const timeoutEvent = setTimeout(() => {
        controller.abort();
    }, timeout);
    const body = post === undefined
        ? undefined
        : serialized ? (post as never as string) : stringify(post, paramEncoding);

    // Perform the network request
    try {
        if (global.FileReader === undefined) {
            let location = url;
            let method: "GET" | "POST" = post === undefined ? "GET" : "POST";
            let requestBody = body;

            for (let i = 0; i < 20; i++) {
                const init: RequestInit = {
                    headers: buildHeaders(requestContentType),
                    // @ts-ignore
                    signal: controller.signal,
                    redirect: "manual",
                    method,
                };

                if (method === "POST") {
                    init.body = requestBody;
                }

                const response = await fetch(location, init);
                updateCookiesFromHeaders(response.headers);

                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    const nextLocation = response.headers.get("Location");
                    if (!nextLocation) {
                        throw new ResponseStatusError(`Unexpected response status code: ${response.status}`);
                    }
                    location = new URL(nextLocation, location).toString();
                    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
                        method = "GET";
                        requestBody = undefined;
                    }
                    continue;
                }

                if (response.status !== 200 && response.status !== 201) {
                    let path = location;
                    try {
                        const queryBegin = path.lastIndexOf("?");
                        if (queryBegin !== -1) {
                            path = path.substring(0, queryBegin);
                        }
                        if (path.endsWith("/")) {
                            path = path.substring(0, path.length - 1);
                        }
                        const nameBegin = path.lastIndexOf("/");
                        path = path.substring(nameBegin + 1);
                    } catch {
                        throw new ResponseStatusError(`Unexpected response status code: ${response.status}`);
                    }
                    throw new ResponseStatusError(`Unexpected response status code: ${response.status} (${path})`);
                }

                const contentType = response.headers.get("Content-Type");
                let base64 = false;
                let charset = "UTF-8";
                if (contentType) {
                    if (contentType.includes("application/octet-stream") || contentType.includes("application/pdf") || contentType.includes("image/")) {
                        base64 = true;
                        charset = "base64";
                    } else {
                        const regRes = /charset=(.*?);/.exec(contentType + ";");
                        if (regRes !== null && regRes[1] !== undefined) {
                            charset = regRes[1];
                        }
                    }
                }

                if (location === CR_TIMETABLE_URL) {
                    charset = "gb2312";
                }

                const arrayBuffer = await response.arrayBuffer();
                return iconv.decode(Buffer.from(arrayBuffer), charset);
            }

            throw new ResponseStatusError("Max redirect times reached.");
        }

        const init = body === undefined
            ? {
                headers: buildHeaders(requestContentType),
                signal: controller.signal,
            }
            : {
                headers: buildHeaders(requestContentType),
                signal: controller.signal,
                method: "POST",
                body,
            };

        // @ts-ignore
        const response = await fetch(url, init);

        if (response.status !== 200 && response.status !== 201) {
            let path = url;
            try {
                const queryBegin = path.lastIndexOf("?");
                if (queryBegin !== -1) {
                    path = path.substring(0, queryBegin);
                }
                if (path.endsWith("/")) {
                    path = path.substring(0, path.length - 1);
                }
                const nameBegin = path.lastIndexOf("/");
                path = path.substring(nameBegin + 1);
            } catch {
                throw new ResponseStatusError(`Unexpected response status code: ${response.status}`);
            }
            throw new ResponseStatusError(`Unexpected response status code: ${response.status} (${path})`);
        }

        // Manage cookies
        updateCookiesFromHeaders(response.headers);

        // Detect charset based on content-type
        const contentType = response.headers.get("Content-Type");
        let base64 = false;
        let charset = "UTF-8";
        if (contentType) {
            if (contentType.includes("application/octet-stream") || contentType.includes("application/pdf") || contentType.includes("image/")) {
                base64 = true;
                charset = "base64";
            } else {
                const regRes = /charset=(.*?);/.exec(contentType + ";");
                if (regRes !== null && regRes[1] !== undefined) {
                    charset = regRes[1];
                }
            }
        }

        if (url === CR_TIMETABLE_URL) {
            charset = "gb2312";
        }

        if (global.FileReader) {
            // For browser and react-native
            const blob = await response.blob();
            return await new Promise<string>(((resolve, reject) => {
                // Use FileReader to read blob data
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (typeof reader.result === "string") {
                        if (base64) {
                            // Simply return the string data with the MIME header removed
                            const r = /data:.+?;base64,(.+)/g.exec(reader.result);
                            if (r !== null && r[1] !== undefined) {
                                resolve(r[1]);
                            } else {
                                reject(new Error("Failed to parse MIME result in uFetch."));
                            }
                        } else {
                            // The value stored in `reader.result` has already been parsed with the correct encoding
                            resolve(reader.result);
                        }
                    } else if (reader.result === null) {
                        resolve("");
                    } else {
                        // This should not happen
                        reject(new Error("Blob parsing error."));
                    }
                };
                // Read and transform
                if (base64) {
                    reader.readAsDataURL(blob);
                } else {
                    reader.readAsText(blob, charset);
                }
            }));
        } else {
            // For node.js
            const arrayBuffer = await response.arrayBuffer();
            // Use iconv-lite to transform arrayBuffer into string
            return iconv.decode(Buffer.from(arrayBuffer), charset);
        }
    } finally {
        // We have to clear the timeout
        clearTimeout(timeoutEvent);
    }
};

export const getRedirectUrl = async (
    url: string,
    timeout = 60000
): Promise<string> => {
    if (global.FileReader) {
        // For browser and react-native
        return new Promise((resolve) => {
            const req = new XMLHttpRequest();
            req.onreadystatechange = () => {
                if (req.readyState === req.DONE) {
                    resolve(req.responseURL ?? "");
                }
            };
            req.open("GET", url);
            req.send();
        });
    }
    // Prepare request headers
    // Handle timeout abortion
    const controller = new AbortController();
    const timeoutEvent = setTimeout(() => {
        controller.abort();
    }, timeout);
    // Perform the network request
    try {
        let location = url;
        for (let i = 0; i < 20; i++) {
            const init: RequestInit = {
                headers: buildHeaders(CONTENT_TYPE_FORM),
                // @ts-ignore
                signal: controller.signal,
                redirect: "manual" // Set the redirect mode to "manual" so fetch won't follow the http redirection
            };
            const response = await fetch(location, init);
            updateCookiesFromHeaders(response.headers);

            if (response.status !== 301 && response.status !== 302) {
                return location;
            }

            location = new URL(response.headers.get("Location") ?? "", location).toString();
        }

        throw new ResponseStatusError("Max redirect times reached.");
    } finally {
        // We have to clear the timeout
        clearTimeout(timeoutEvent);
    }
};
