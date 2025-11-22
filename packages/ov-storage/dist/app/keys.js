export function normalizeKey(idOrName) {
    return idOrName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}
export function buildPrivatePath(userDid, fileName, fileId) {
    const safeDid = userDid.replace(/[:]/g, "_");
    const safeName = normalizeKey(fileName);
    return `users/${safeDid}/uploads/${safeName}/${fileId}`;
}
export function buildPublicPath(username, fileId) {
    const safeUser = normalizeKey(username);
    return `public/${safeUser}/${fileId}`;
}
