export function normalizeKey(idOrName: string): string {
  return idOrName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

export function buildPrivatePath(userDid: string, fileName: string, fileId: string): string {
  const safeDid = userDid.replace(/[:]/g, "_");
  const safeName = normalizeKey(fileName);
  return `users/${safeDid}/uploads/${safeName}/${fileId}`;
}

export function buildPublicPath(username: string, fileId: string): string {
  const safeUser = normalizeKey(username);
  return `public/${safeUser}/${fileId}`;
}


