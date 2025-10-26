import { Request } from "express";

export function extractAuthHeader(request: Request): string | null {

    if (request.headers["Authorization"]) return String(request.headers["Authorization"]);
    
    if (request.headers["authorization"]) return String(request.headers["authorization"]);

    return null;
}

export function extractBearerToken(request: Request): string | null {
    const authHeader = extractAuthHeader(request);
    if (!authHeader) return null;

    const parts = authHeader.split(" ");
    if (parts.length !== 2) return null;

    const scheme = parts[0];
    const token = parts[1];

    if (/^Bearer$/i.test(scheme)) {
        return token;
    }
    return null;
}   