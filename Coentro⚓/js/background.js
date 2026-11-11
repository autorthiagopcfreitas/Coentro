chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({ url: "index.html" });
});

const TRANSLATION_JOBS_KEY = "translationJobsV1";
const TRANSLATION_QUEUE_KEY = "translationQueueV1";
const TRANSLATION_TICK_ALARM = "translationQueueTick";
let translationQueueProcessing = false;
const translationAbortControllers = new Map();

function storageGet(key) {
    return new Promise(resolve => {
        chrome.storage.local.get(key, result => resolve(result ? result[key] : null));
    });
}

function storageSet(key, value) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
    });
}

function sanitizeBookStorageKeyPart(value) {
    return String(value || "").replace(/[^\w]/g, "");
}

function normalizeLanguageCode(code) {
    return String(code || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-")
        .split("-")[0] || "unknown";
}

function simpleHashText(text) {
    let hash = 5381;
    const raw = String(text || "");
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
        hash |= 0;
    }
    return String(hash >>> 0);
}

function getApproxTextLengthFromHtml(html) {
    const text = String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length;
}

function isTranslatedHtmlUsable(originalHtml, translatedHtml) {
    const original = String(originalHtml || "");
    const translated = String(translatedHtml || "");
    if (!translated.trim() || translated === original) {
        return false;
    }
    const originalLen = getApproxTextLengthFromHtml(original);
    const translatedLen = getApproxTextLengthFromHtml(translated);
    if (translatedLen === 0) {
        return false;
    }
    if (originalLen > 120 && translatedLen < Math.round(originalLen * 0.02)) {
        return false;
    }
    return true;
}

function isAbortError(error) {
    return !!(error && (error.name === "AbortError" || error.code === 20));
}

function classifyTranslationError(error, job = {}) {
    const rawMessage = String(error?.message || "Unknown translation failure");
    const msg = rawMessage.toLowerCase();
    const provider = String(job?.provider || "google").toLowerCase();
    const httpMatch = msg.match(/http\s*(\d{3})/i);
    const httpStatus = httpMatch ? Number(httpMatch[1]) : 0;
    const buildHttpCode = status => {
        const safe = Math.max(100, Math.min(599, Number(status) || 0));
        if (provider === "hf-selfhost") {
            return `TRN-HF-${safe}`;
        }
        if (provider === "google") {
            return `TRN-GGL-${safe}`;
        }
        return `TRN-HTTP-${safe}`;
    };
    const buildHttpCommon = status => {
        const s = Number(status) || 0;
        if (s === 400) {
            return ["Invalid request payload", "Unsupported input shape", "Provider validation failed"];
        }
        if (s === 408) {
            return ["Provider timed out", "Slow upstream response", "Intermittent network latency"];
        }
        if (s === 413) {
            return ["Chapter/request too large", "Payload limit exceeded", "Need smaller translation chunks"];
        }
        if (s === 415) {
            return ["Unsupported media/content type", "Invalid request headers", "Provider format mismatch"];
        }
        if (s === 422) {
            return ["Semantic validation failed", "Invalid parameter combination", "Provider rejected content"];
        }
        if (s >= 500) {
            return ["Provider instability", "Temporary outage", "Backend overload"];
        }
        return ["Request rejected by provider", "Quota/policy constraints", "Unexpected endpoint behavior"];
    };

    if (isAbortError(error)) {
        return {
            code: "TRN-ABORT-001",
            summary: "Translation aborted while processing chapter.",
            common: [
                "User paused/deleted the task",
                "Background worker restarted"
            ]
        };
    }
    if (httpStatus === 401 || httpStatus === 403) {
        return {
            code: "TRN-AUTH-401",
            summary: "Authentication/authorization rejected by translation provider.",
            common: [
                "Invalid API key",
                "Token missing/expired",
                "Provider access policy denied"
            ]
        };
    }
    if (httpStatus === 404) {
        return {
            code: buildHttpCode(404),
            summary: "Provider endpoint/model route not found.",
            common: [
                "Wrong API URL",
                "Model endpoint unavailable",
                "Provider route changed"
            ]
        };
    }
    if (httpStatus === 429) {
        return {
            code: buildHttpCode(429),
            summary: "Rate limit reached at translation provider.",
            common: [
                "Too many requests",
                "Quota exhausted",
                "Provider throttling"
            ]
        };
    }
    if (httpStatus >= 500) {
        return {
            code: buildHttpCode(httpStatus),
            summary: "Provider internal/server error.",
            common: buildHttpCommon(httpStatus)
        };
    }
    if (httpStatus >= 400) {
        return {
            code: buildHttpCode(httpStatus),
            summary: `Provider rejected request with HTTP ${httpStatus}.`,
            common: buildHttpCommon(httpStatus)
        };
    }
    if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network error")) {
        return {
            code: "TRN-NET-FETCH",
            summary: "Network transport failure while contacting provider.",
            common: [
                "Offline connection",
                "DNS/proxy issues",
                "Firewall/CORS block"
            ]
        };
    }
    if (msg.includes("timeout") || msg.includes("timed out")) {
        return {
            code: "TRN-NET-TIMEOUT",
            summary: "Translation request timed out.",
            common: [
                "Slow provider response",
                "Large chapter payload",
                "Unstable network latency"
            ]
        };
    }
    if (msg.includes("json") || msg.includes("unexpected token")) {
        return {
            code: "TRN-RESP-PARSE",
            summary: "Invalid/unsupported response payload from provider.",
            common: [
                "Provider output format changed",
                "Gateway/proxy altered response",
                "HTML error page returned as JSON"
            ]
        };
    }
    return {
        code: "TRN-UNK-001",
        summary: "Unexpected translation failure.",
        common: [
            "Provider incompatibility",
            "Corrupted request payload",
            "Unhandled runtime exception"
        ]
    };
}

async function translateViaGoogle(text, targetLang, sourceLang = "auto", signal = null) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(String(text || ""))}`;
    const response = await fetch(url, { signal: signal || undefined });
    if (!response.ok) {
        throw new Error(`Google translate HTTP ${response.status}`);
    }
    const payload = await response.json();
    const translated = Array.isArray(payload?.[0])
        ? payload[0].map(part => Array.isArray(part) ? (part[0] || "") : "").join("")
        : "";
    return translated || String(text || "");
}

async function translateViaHFSelfHost(text, targetLang, sourceLang = "auto", config = {}, signal = null) {
    const endpoint = config.apiUrl || "http://127.0.0.1:8000/translate";
    const response = await fetch(endpoint, {
        method: "POST",
        signal: signal || undefined,
        headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { "authorization": `Bearer ${config.apiKey}` } : {})
        },
        body: JSON.stringify({
            text: String(text || ""),
            targetLang,
            sourceLang,
            model: config.model || "facebook/nllb-200-distilled-600M"
        })
    });
    if (!response.ok) {
        throw new Error(`HF self-host HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (typeof payload?.translatedText === "string") {
        return payload.translatedText;
    }
    if (Array.isArray(payload?.translations) && typeof payload.translations[0] === "string") {
        return payload.translations[0];
    }
    return String(text || "");
}

async function translateChapterHtmlWithRetry(html, job, maxAttempts = 3, signal = null) {
    const provider = job?.provider || "google";
    const targetLanguage = job?.targetLanguage || "en";
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (provider === "hf-selfhost") {
                return await translateViaHFSelfHost(html, targetLanguage, "auto", {
                    apiUrl: job.apiUrl,
                    apiKey: job.apiKey,
                    model: job.model
                }, signal);
            }
            return await translateViaGoogle(html, targetLanguage, "auto", signal);
        } catch (error) {
            if (isAbortError(error) || (signal && signal.aborted)) {
                throw error;
            }
            lastError = error;
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 220 * attempt));
            }
        }
    }
    throw lastError || new Error("Chapter translation failed.");
}

function scheduleTranslationTick(delayMs = 1200) {
    chrome.alarms.create(TRANSLATION_TICK_ALARM, { when: Date.now() + Math.max(500, Number(delayMs) || 500) });
}

async function markTranslationLanguageAvailable(job) {
    const key = String(job?.bookStorageKey || "");
    const lang = String(job?.targetLanguage || "").trim();
    if (!key || !lang) {
        return;
    }
    const index = (await storageGet("bookTranslationLanguageIndexV1")) || {};
    const entry = index[key] || { langs: [] };
    const langs = new Set(Array.isArray(entry.langs) ? entry.langs : []);
    langs.add(lang);
    index[key] = {
        ...entry,
        title: job?.title || entry.title || "",
        author: job?.author || entry.author || "",
        langs: [...langs].filter(Boolean),
        updatedAt: Date.now()
    };
    await storageSet("bookTranslationLanguageIndexV1", index);
}

async function enqueueTranslationJob(rawJob) {
    const jobId = String(rawJob?.id || "").trim();
    if (!jobId) {
        throw new Error("Invalid translation job id.");
    }
    const jobs = (await storageGet(TRANSLATION_JOBS_KEY)) || {};
    const queue = (await storageGet(TRANSLATION_QUEUE_KEY)) || [];
    const settings = (await storageGet("settings")) || {};
    const preferredTarget = normalizeLanguageCode(settings?.preferredLanguage || rawJob?.targetLanguage || "pt");
    const requestedTarget = normalizeLanguageCode(rawJob?.targetLanguage || preferredTarget);
    const targetLanguage = preferredTarget !== "unknown" ? preferredTarget : requestedTarget;
    const normalizedBookKey = String(rawJob?.bookStorageKey || "").trim();
    const now = Date.now();
    const duplicateIds = [];
    const duplicateEntries = [];
    Object.entries(jobs).forEach(([id, job]) => {
        if (!job) {
            return;
        }
        const sameBook = normalizedBookKey && String(job.bookStorageKey || "").trim() === normalizedBookKey;
        if (!sameBook) {
            return;
        }
        const lang = normalizeLanguageCode(job.targetLanguage || "");
        // Keep only one job per book, always aligned with current preferred target language.
        if (id !== jobId) {
            duplicateIds.push(id);
            duplicateEntries.push(job);
        }
        if (lang !== targetLanguage) {
            duplicateIds.push(id);
        }
    });
    const uniqueDuplicateIds = [...new Set(duplicateIds)];
    const bestDuplicate = duplicateEntries
        .filter(Boolean)
        .sort((a, b) =>
            (Number(b.translatedChapters) || 0) - (Number(a.translatedChapters) || 0)
            || (Number(b.progress) || 0) - (Number(a.progress) || 0)
            || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
        )[0] || {};
    const existing = jobs[jobId] || bestDuplicate || {};
    const existingStatus = String(existing.status || "").trim();
    const nextStatus = existingStatus === "completed"
        ? "completed"
        : (existingStatus === "paused" ? "paused" : (existingStatus || "pending"));

    uniqueDuplicateIds.forEach(id => {
        if (id === jobId) {
            return;
        }
        delete jobs[id];
    });
    const compactQueue = queue.filter(id => !uniqueDuplicateIds.includes(id) || id === jobId);

    jobs[jobId] = {
        ...existing,
        ...rawJob,
        id: jobId,
        targetLanguage,
        status: nextStatus,
        queuedAt: existing.queuedAt || now,
        startedAt: existing.startedAt || null,
        finishedAt: null,
        progress: Number(existing.progress) || 0,
        translatedChapters: Number(existing.translatedChapters) || 0,
        startChapter: Math.max(0, Number(rawJob?.startChapter ?? existing.startChapter) || 0),
        scheduledAt: Number(rawJob?.scheduledAt ?? existing.scheduledAt) > 0 ? Number(rawJob?.scheduledAt ?? existing.scheduledAt) : null,
        updatedAt: now
    };
    const nextQueue = compactQueue.filter(id => id !== jobId);
    if (nextStatus !== "paused" && nextStatus !== "completed") {
        nextQueue.push(jobId);
    }
    await storageSet(TRANSLATION_JOBS_KEY, jobs);
    await storageSet(TRANSLATION_QUEUE_KEY, nextQueue);
    scheduleTranslationTick(300);
}

async function pauseTranslationJob(rawJobId) {
    const jobId = String(rawJobId || "").trim();
    if (!jobId) {
        throw new Error("Invalid translation job id.");
    }
    const jobs = (await storageGet(TRANSLATION_JOBS_KEY)) || {};
    const queue = ((await storageGet(TRANSLATION_QUEUE_KEY)) || []).filter(Boolean);
    const job = jobs[jobId];
    if (!job) {
        throw new Error("Translation job not found.");
    }
    if (String(job.status || "") !== "completed") {
        jobs[jobId] = {
            ...job,
            status: "paused",
            finishedAt: null,
            updatedAt: Date.now(),
            error: "",
            errorCode: "",
            errorSummary: "",
            errorCommon: []
        };
    }
    const nextQueue = queue.filter(id => id !== jobId);
    await storageSet(TRANSLATION_JOBS_KEY, jobs);
    await storageSet(TRANSLATION_QUEUE_KEY, nextQueue);
    const controller = translationAbortControllers.get(jobId);
    if (controller) {
        controller.abort();
    }
    return jobs[jobId];
}

async function resumeTranslationJob(rawJobId) {
    const jobId = String(rawJobId || "").trim();
    if (!jobId) {
        throw new Error("Invalid translation job id.");
    }
    const jobs = (await storageGet(TRANSLATION_JOBS_KEY)) || {};
    const queue = ((await storageGet(TRANSLATION_QUEUE_KEY)) || []).filter(Boolean);
    const job = jobs[jobId];
    if (!job) {
        throw new Error("Translation job not found.");
    }
    const status = String(job.status || "");
    const isCompleted = status === "completed";
    const skippedErrorIndexes = [...new Set(
        (Array.isArray(job.skippedErrorChapterIndexes) ? job.skippedErrorChapterIndexes : [])
            .map(index => Number(index))
            .filter(index => Number.isInteger(index) && index >= 0)
    )];
    const skippedErrorCount = Math.max(0, Number(job.skippedErrorChapters) || 0);
    const hasRecoverableCompletedErrors = isCompleted && (skippedErrorIndexes.length > 0 || skippedErrorCount > 0);
    let reopenedChapterIndexes = [];
    let restartedFromCompleted = false;

    if (hasRecoverableCompletedErrors) {
        const translationStorageKey = String(job.storageKey || "").trim();
        const storageBookKey = String(job.bookStorageKey || `library-${sanitizeBookStorageKeyPart(job.title)}`).trim();
        if (translationStorageKey && storageBookKey) {
            const [book, persisted] = await Promise.all([
                storageGet(storageBookKey),
                storageGet(translationStorageKey)
            ]);
            const baseHtml = Array.isArray(book?.contents)
                ? book.contents.map(ch => (ch && ch.innerHTML != null) ? String(ch.innerHTML) : "")
                : [];
            const persistedChapters = Array.isArray(persisted?.chapters) ? [...persisted.chapters] : [];
            const fallbackIndexes = [];

            if (skippedErrorIndexes.length === 0 && baseHtml.length > 0) {
                for (let i = 0; i < baseHtml.length; i++) {
                    const sourceHtml = baseHtml[i];
                    const entry = persistedChapters[i];
                    if (!entry || typeof entry.translated !== "string") {
                        continue;
                    }
                    if (entry.hash === simpleHashText(sourceHtml) && entry.translated === sourceHtml) {
                        fallbackIndexes.push(i);
                    }
                }
            }

            const candidateIndexes = skippedErrorIndexes.length > 0 ? skippedErrorIndexes : fallbackIndexes;
            candidateIndexes.forEach(index => {
                if (index < 0 || index >= persistedChapters.length) {
                    return;
                }
                if (persistedChapters[index] == null) {
                    return;
                }
                persistedChapters[index] = null;
                reopenedChapterIndexes.push(index);
            });

            if (reopenedChapterIndexes.length > 0) {
                await storageSet(translationStorageKey, {
                    ...(persisted || {}),
                    updatedAt: Date.now(),
                    chapters: persistedChapters
                });
            }
        }
    } else if (isCompleted) {
        // Allow manual retry/retranslation even for fully completed jobs.
        const translationStorageKey = String(job.storageKey || "").trim();
        const storageBookKey = String(job.bookStorageKey || `library-${sanitizeBookStorageKeyPart(job.title)}`).trim();
        if (translationStorageKey && storageBookKey) {
            const [book, persisted] = await Promise.all([
                storageGet(storageBookKey),
                storageGet(translationStorageKey)
            ]);
            const total = Array.isArray(book?.contents) ? book.contents.length : 0;
            if (total > 0) {
                const startChapter = Math.max(0, Math.min(total, Number(job.startChapter) || 0));
                const persistedChapters = Array.isArray(persisted?.chapters) ? [...persisted.chapters] : [];
                for (let i = startChapter; i < total; i++) {
                    if (persistedChapters[i] != null) {
                        reopenedChapterIndexes.push(i);
                    }
                    persistedChapters[i] = null;
                }
                await storageSet(translationStorageKey, {
                    ...(persisted || {}),
                    updatedAt: Date.now(),
                    chapters: persistedChapters
                });
                restartedFromCompleted = true;
            }
        }
    }

    const reopenedSet = new Set(reopenedChapterIndexes);
    const remainingSkippedIndexes = skippedErrorIndexes.filter(index => !reopenedSet.has(index));
    jobs[jobId] = {
        ...job,
        status: "pending",
        finishedAt: null,
        retryCount: 0,
        scheduledAt: null,
        translatedChapters: restartedFromCompleted ? 0 : Number(job.translatedChapters) || 0,
        progress: restartedFromCompleted ? 0 : Number(job.progress) || 0,
        skippedErrorChapters: Math.max(0, skippedErrorCount - reopenedChapterIndexes.length),
        skippedErrorChapterIndexes: remainingSkippedIndexes,
        updatedAt: Date.now(),
        error: "",
        errorCode: "",
        errorSummary: "",
        errorCommon: []
    };
    if (!queue.includes(jobId)) {
        queue.push(jobId);
    }
    await storageSet(TRANSLATION_JOBS_KEY, jobs);
    await storageSet(TRANSLATION_QUEUE_KEY, queue);
    scheduleTranslationTick(300);
    return jobs[jobId];
}

async function deleteTranslationJob(rawJobId) {
    const jobId = String(rawJobId || "").trim();
    if (!jobId) {
        throw new Error("Invalid translation job id.");
    }
    const jobs = (await storageGet(TRANSLATION_JOBS_KEY)) || {};
    const queue = ((await storageGet(TRANSLATION_QUEUE_KEY)) || []).filter(Boolean);
    if (!jobs[jobId]) {
        return null;
    }
    const controller = translationAbortControllers.get(jobId);
    if (controller) {
        controller.abort();
    }
    delete jobs[jobId];
    const nextQueue = queue.filter(id => id !== jobId);
    await storageSet(TRANSLATION_JOBS_KEY, jobs);
    await storageSet(TRANSLATION_QUEUE_KEY, nextQueue);
    return true;
}

async function processNextTranslationJob() {
    if (translationQueueProcessing) {
        return;
    }
    translationQueueProcessing = true;
    try {
        const jobs = (await storageGet(TRANSLATION_JOBS_KEY)) || {};
        const queue = ((await storageGet(TRANSLATION_QUEUE_KEY)) || []).filter(Boolean);
        let queueChanged = false;
        let earliestScheduledAt = null;
        const now = Date.now();

        for (let q = 0; q < queue.length; q++) {
            const jobId = queue[q];
            const job = jobs[jobId];
            if (!job) {
                queue.splice(q, 1);
                q--;
                queueChanged = true;
                continue;
            }
            if (String(job.status || "") === "paused") {
                queue.splice(q, 1);
                q--;
                queueChanged = true;
                continue;
            }
            const scheduledAt = Number(job.scheduledAt) || 0;
            if (scheduledAt > now) {
                earliestScheduledAt = earliestScheduledAt == null ? scheduledAt : Math.min(earliestScheduledAt, scheduledAt);
                if (String(job.status || "") !== "pending") {
                    jobs[jobId] = {
                        ...job,
                        status: "pending",
                        updatedAt: Date.now()
                    };
                    await storageSet(TRANSLATION_JOBS_KEY, jobs);
                }
                continue;
            }

            const storageBookKey = String(job.bookStorageKey || `library-${sanitizeBookStorageKeyPart(job.title)}`);
            const book = await storageGet(storageBookKey);
            if (!book || !Array.isArray(book.contents) || !book.contents.length) {
                jobs[jobId] = {
                    ...job,
                    status: "error",
                    error: "Livro nao encontrado no armazenamento.",
                    errorCode: "TRN-JOB-404",
                    errorSummary: "Source book payload was not found in local storage.",
                    errorCommon: ["Book deleted or storage key changed", "Corrupted local storage entry"],
                    updatedAt: Date.now()
                };
                queue.splice(q, 1);
                q--;
                queueChanged = true;
                continue;
            }

            const baseHtml = book.contents.map(ch => (ch && ch.innerHTML != null) ? String(ch.innerHTML) : "");
            const total = Math.max(1, baseHtml.length);
            const translationStorageKey = String(job.storageKey || "");
            if (!translationStorageKey) {
                jobs[jobId] = {
                    ...job,
                    status: "error",
                    error: "storageKey de traduÃ§Ã£o ausente.",
                    errorCode: "TRN-CONF-001",
                    errorSummary: "Translation storage key is missing.",
                    errorCommon: ["Job metadata incomplete", "Migration inconsistency"],
                    updatedAt: Date.now()
                };
                queue.splice(q, 1);
                q--;
                queueChanged = true;
                continue;
            }

            const persisted = (await storageGet(translationStorageKey)) || {};
            const persistedChapters = Array.isArray(persisted?.chapters) ? persisted.chapters : [];
            const pendingIndexes = [];
            const startChapter = Math.max(0, Math.min(total, Number(job.startChapter) || 0));
            const scopeTotal = Math.max(0, total - startChapter);
            let doneCount = 0;
            for (let i = startChapter; i < total; i++) {
                const html = baseHtml[i];
                const sourceHash = simpleHashText(html);
                const entry = persistedChapters[i];
                if (entry && entry.hash === sourceHash && typeof entry.translated === "string" && String(entry.translated).trim().length > 0) {
                    doneCount += 1;
                    continue;
                }
                pendingIndexes.push(i);
            }

            if (pendingIndexes.length === 0) {
                jobs[jobId] = {
                    ...job,
                    totalChapters: total,
                    startChapter,
                    skippedChapters: startChapter,
                    translatedChapters: doneCount,
                    progress: 100,
                    status: "completed",
                    finishedAt: job.finishedAt || Date.now(),
                    updatedAt: Date.now(),
                    error: "",
                    errorCode: "",
                    errorSummary: "",
                    errorCommon: []
                };
                queue.splice(q, 1);
                q--;
                queueChanged = true;
                continue;
            }

            const chapterIndex = pendingIndexes[0];
            const html = baseHtml[chapterIndex] || "";
            jobs[jobId] = {
                ...job,
                totalChapters: total,
                startChapter,
                skippedChapters: startChapter,
                translatedChapters: doneCount,
                progress: scopeTotal <= 0 ? 100 : Math.max(0, Math.min(99, Math.round((doneCount / scopeTotal) * 100))),
                status: "running",
                currentChapter: chapterIndex + 1,
                startedAt: job.startedAt || Date.now(),
                finishedAt: null,
                scheduledAt: null,
                updatedAt: Date.now(),
                error: "",
                errorCode: "",
                errorSummary: "",
                errorCommon: []
            };
            await storageSet(TRANSLATION_JOBS_KEY, jobs);

            let translatedHtml = "";
            const chapterAbortController = new AbortController();
            translationAbortControllers.set(jobId, chapterAbortController);
            try {
                translatedHtml = await translateChapterHtmlWithRetry(html, jobs[jobId], 3, chapterAbortController.signal);
            } catch (error) {
                if (isAbortError(error) || chapterAbortController.signal.aborted) {
                    const latestJobs = (await storageGet(TRANSLATION_JOBS_KEY)) || {};
                    const latestJob = latestJobs[jobId];
                    if (!latestJob) {
                        delete jobs[jobId];
                        queue.splice(q, 1);
                        q--;
                        queueChanged = true;
                        break;
                    }
                    if (String(latestJob?.status || "") === "paused") {
                        jobs[jobId] = latestJob;
                        queue.splice(q, 1);
                        q--;
                        queueChanged = true;
                        break;
                    }
                }
                const currentRetryCount = Number(jobs[jobId]?.retryCount ?? job.retryCount) || 0;
                const retryCount = currentRetryCount + 1;
                const errorMessage = error?.message || "Falha ao traduzir capitulo.";
                const classified = classifyTranslationError(error, jobs[jobId]);
                if (retryCount >= 5) {
                    // Avoid dead-end "Erro": mark chapter as skipped and keep queue moving.
                    persistedChapters[chapterIndex] = {
                        hash: simpleHashText(html),
                        translated: html
                    };
                    await storageSet(translationStorageKey, {
                        updatedAt: Date.now(),
                        chapters: persistedChapters
                    });
                    const previousSkippedIndexes = [...new Set(
                        (Array.isArray(jobs[jobId]?.skippedErrorChapterIndexes) ? jobs[jobId].skippedErrorChapterIndexes : [])
                            .map(index => Number(index))
                            .filter(index => Number.isInteger(index) && index >= 0)
                    )];
                    if (!previousSkippedIndexes.includes(chapterIndex)) {
                        previousSkippedIndexes.push(chapterIndex);
                    }
                    jobs[jobId] = {
                        ...jobs[jobId],
                        retryCount: 0,
                        skippedErrorChapters: previousSkippedIndexes.length,
                        skippedErrorChapterIndexes: previousSkippedIndexes.sort((a, b) => a - b),
                        status: "pending",
                        error: `Capitulo ${chapterIndex + 1} pulado apos falhas repetidas. ${errorMessage}`,
                        errorCode: classified.code,
                        errorSummary: classified.summary,
                        errorCommon: classified.common,
                        errorChapter: chapterIndex + 1,
                        updatedAt: Date.now()
                    };
                } else {
                    jobs[jobId] = {
                        ...jobs[jobId],
                        retryCount,
                        status: "pending",
                        error: errorMessage,
                        errorCode: classified.code,
                        errorSummary: classified.summary,
                        errorCommon: classified.common,
                        errorChapter: chapterIndex + 1,
                        updatedAt: Date.now()
                    };
                }
                await storageSet(TRANSLATION_JOBS_KEY, jobs);
                break;
            } finally {
                translationAbortControllers.delete(jobId);
            }

            if (typeof translatedHtml === "string" && translatedHtml.trim().length > 0) {
                persistedChapters[chapterIndex] = {
                    hash: simpleHashText(html),
                    translated: translatedHtml
                };
                await storageSet(translationStorageKey, {
                    updatedAt: Date.now(),
                    chapters: persistedChapters
                });
                await markTranslationLanguageAvailable(jobs[jobId]);
            }

            const newDone = doneCount + 1;
            const completed = scopeTotal <= 0 || newDone >= scopeTotal;
            const skippedIndexesAfterSuccess = [...new Set(
                (Array.isArray(jobs[jobId]?.skippedErrorChapterIndexes) ? jobs[jobId].skippedErrorChapterIndexes : [])
                    .map(index => Number(index))
                    .filter(index => Number.isInteger(index) && index >= 0 && index !== chapterIndex)
            )];
            jobs[jobId] = {
                ...jobs[jobId],
                translatedChapters: Math.min(scopeTotal, newDone),
                totalChapters: total,
                startChapter,
                skippedChapters: startChapter,
                skippedErrorChapters: skippedIndexesAfterSuccess.length,
                skippedErrorChapterIndexes: skippedIndexesAfterSuccess,
                progress: completed ? 100 : Math.max(1, Math.min(99, Math.round((newDone / Math.max(1, scopeTotal)) * 100))),
                status: completed ? "completed" : "running",
                finishedAt: completed ? Date.now() : null,
                retryCount: 0,
                updatedAt: Date.now(),
                error: "",
                errorCode: "",
                errorSummary: "",
                errorCommon: [],
                errorChapter: 0
            };
            if (completed) {
                queue.splice(q, 1);
                q--;
                queueChanged = true;
            }
            await storageSet(TRANSLATION_JOBS_KEY, jobs);
            break;
        }

        if (queueChanged) {
            await storageSet(TRANSLATION_QUEUE_KEY, queue);
        }
        if (queue.length > 0) {
            const delay = earliestScheduledAt != null
                ? Math.max(500, earliestScheduledAt - Date.now())
                : 1200;
            scheduleTranslationTick(delay);
        }
    } catch (error) {
        console.error("[TranslationQueue] processing failed:", error);
        scheduleTranslationTick(4000);
    } finally {
        translationQueueProcessing = false;
    }
}

// Handle messages from content scripts or extension pages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ensureZLibTab") {
        ensureZLibTab()
            .then(tabId => sendResponse({ success: true, tabId }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "searchZLib") {
        handleZLibSearch(request.url)
            .then(payload => sendResponse({ success: true, html: payload.html, origin: payload.origin, nextData: payload.nextData, nuxtData: payload.nuxtData }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "translationQueueEnqueue") {
        enqueueTranslationJob(request.job || {})
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "translationQueueSnapshot") {
        Promise.all([
            storageGet(TRANSLATION_JOBS_KEY),
            storageGet(TRANSLATION_QUEUE_KEY)
        ])
            .then(([jobs, queue]) => sendResponse({ success: true, jobs: jobs || {}, queue: queue || [] }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "translationQueuePause") {
        pauseTranslationJob(request.jobId)
            .then(job => sendResponse({ success: true, job }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "translationQueueResume") {
        resumeTranslationJob(request.jobId)
            .then(job => sendResponse({ success: true, job }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === "translationQueueDelete") {
        deleteTranslationJob(request.jobId)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm && alarm.name === TRANSLATION_TICK_ALARM) {
        void processNextTranslationJob();
    }
});

chrome.runtime.onStartup.addListener(() => {
    scheduleTranslationTick(500);
});

chrome.runtime.onInstalled.addListener(() => {
    scheduleTranslationTick(500);
});

// Function to be injected into Z-Library page
// This runs in the page context so we can read the rendered DOM (SPA-friendly).
function captureZLibDomHtml() {
    return new Promise((resolve) => {
        const selectors = [
            ".resItemBox",
            ".resItemBoxHover",
            ".bookRow",
            ".book-row",
            ".book-item",
            ".bookItem",
            ".book-card",
            ".searchResultItem",
            ".search-result-item",
            "a[href*='/book/']",
            "a[href*='/b/']"
        ];

        const hasResults = () => selectors.some(sel => document.querySelector(sel));
        const maxWait = 20000;
        const interval = 250;
        const start = Date.now();

        const check = () => {
            if (hasResults() || (Date.now() - start) > maxWait) {
                const html = document.documentElement ? document.documentElement.outerHTML : "";
                const nextData = (window.__NEXT_DATA__ && JSON.stringify(window.__NEXT_DATA__))
                    || document.querySelector("#__NEXT_DATA__")?.textContent
                    || "";
                const nuxtData = (window.__NUXT__ && JSON.stringify(window.__NUXT__)) || "";
                resolve({ html: html || "", nextData, nuxtData });
                return;
            }
            setTimeout(check, interval);
        };

        check();
    });
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(false);
        }, timeoutMs);

        const listener = (updatedTabId, info) => {
            if (updatedTabId !== tabId) return;
            if (info.status === "complete") {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(true);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Search Z-Library using page DOM capture (runs in page context)
async function handleZLibSearch(url) {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`[ZLib Search] Attempt ${attempt + 1}/${maxRetries} for URL: ${url}`);

            // Ensure we have a Z-Library tab
            const tabId = await ensureZLibTab();
            console.log(`[ZLib Search] Using tab ID: ${tabId}`);

            // Navigate tab to search URL so SPA results are rendered.
            await new Promise((resolve, reject) => {
                chrome.tabs.update(tabId, { url: url, active: false }, (tab) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(tab);
                });
            });

            await waitForTabComplete(tabId, 15000);

            // Capture rendered DOM HTML from the page context
            const capture = await new Promise((resolve, reject) => {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: captureZLibDomHtml
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        console.error(`[ZLib Search] Scripting error:`, chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (results && results[0] && results[0].result) {
                        const result = results[0].result;
                        console.log(`[ZLib Search] DOM capture result:`, result?.html ? `Success (${result.html.length} chars)` : "Empty");
                        if (result?.html) {
                            resolve(result);
                        } else {
                            reject(new Error("Empty DOM HTML"));
                        }
                    } else {
                        console.error(`[ZLib Search] No results from DOM capture`);
                        reject(new Error("Failed to capture DOM"));
                    }
                });
            });

            const tabInfo = await new Promise((resolve) => {
                chrome.tabs.get(tabId, (tab) => {
                    resolve(tab || null);
                });
            });

            const finalUrl = tabInfo && tabInfo.url ? tabInfo.url : "";
            const origin = finalUrl ? new URL(finalUrl).origin : "";
            const html = capture.html;
            const nextData = capture.nextData || "";
            const nuxtData = capture.nuxtData || "";

            // Success - return the HTML
            console.log(`[ZLib Search] Success! Got ${html.length} characters of HTML`);
            return { html, origin, nextData, nuxtData };

        } catch (error) {
            console.error(`[ZLib Search] Attempt ${attempt + 1} failed:`, error.message);

            // Check if it's a 503 error and we have retries left
            const is503 = error.message && error.message.includes("503");

            if (is503 && attempt < maxRetries - 1) {
                const retryDelay = 3000 * (attempt + 1);
                console.log(`[ZLib Search] 503 error, retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue; // Retry
            }

            // If it's the last attempt or not a 503, throw the error
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // For other errors, wait and retry
            const retryDelay = 2000 * (attempt + 1);
            console.log(`[ZLib Search] Retrying in ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw new Error("Max retries exceeded");
}

// Create a fresh Z-Library tab and wait until ready.
// Works in both Chrome and Edge.
async function ensureZLibTab() {
    return new Promise((resolve, reject) => {
        const tabsAPI = chrome.tabs || browser.tabs;

        tabsAPI.create({
            url: "https://pt.z-lib.fm",
            active: false
        }, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            let listener;
            const timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(tab.id);
            }, 10000);

            listener = function (tabId, info) {
                if (tabId === tab.id && info.status === "complete") {
                    clearTimeout(timeout);
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(tabId);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

