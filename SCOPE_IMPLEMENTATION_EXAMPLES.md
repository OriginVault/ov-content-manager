# Scope Implementation Examples for Content Manager API

## 🔧 **Route-Specific Scope Requirements**

### **File Management Routes** (`/files`)
```typescript
// Request upload URL
router.post("/request-upload-url", requireAuth, requireScope('write:files'), uploadLimiter, async (req, res) => {
  // Implementation
});

// Authenticated upload
router.post("/upload-authenticated", requireAuth, requireScope('write:files'), uploadLimiter, upload.single("file"), async (req, res) => {
  // Implementation
});

// List files
router.get("/list", requireAuth, requireScope('read:files'), async (req, res) => {
  // Implementation
});

// Delete file
router.delete("/:fileId", requireAuth, requireScope('delete:files'), async (req, res) => {
  // Implementation
});
```

### **Bucket Management Routes** (`/buckets`) - ADMIN/BUCKET MANAGER ONLY
```typescript
// Create bucket
router.post("/create_bucket", requireAuth, requireScope('write:buckets'), async (req, res) => {
  // Implementation
});

// List buckets - RESTRICTED: Only admins and bucket managers
router.get("/list_buckets", requireAuth, requireScope('read:buckets'), async (req, res) => {
  // Implementation
});

// Check bucket exists - RESTRICTED: Only admins and bucket managers
router.get("/bucket_exists", requireAuth, requireScope('read:buckets'), async (req, res) => {
  // Implementation
});

// Delete bucket
router.delete("/:bucketName", requireAuth, requireScope('delete:buckets'), async (req, res) => {
  // Implementation
});
```

### **Enhanced Bucket Management** (`/bucket`) - ADMIN/BUCKET MANAGER ONLY
```typescript
// Get quota information
router.get("/quota", requireAuth, requireScope('read:profile'), bucketLimiter, async (req, res) => {
  // Implementation
});

// Get bucket statistics - RESTRICTED: Only admins and bucket managers
router.get("/stats", requireAuth, requireScope('manage:buckets'), bucketLimiter, async (req, res) => {
  // Implementation
});

// Cleanup expired files - RESTRICTED: Only admins and bucket managers
router.post("/cleanup", requireAuth, requireScope('manage:buckets'), bucketLimiter, async (req, res) => {
  // Implementation
});
```

### **Storage Routes** (`/storage`)
```typescript
// Upload to storage
router.post("/upload", requireAuth, requireScope('write:storage'), storageLimiter, upload.single("file"), async (req, res) => {
  // Implementation
});

// List storage files
router.get("/files", requireAuth, requireScope('read:storage'), storageLimiter, async (req, res) => {
  // Implementation
});

// Get storage info
router.get("/info", requireAuth, requireScope('read:storage'), storageLimiter, async (req, res) => {
  // Implementation
});
```

### **C2PA Manifest Routes** (`/manifests`)
```typescript
// Sign file with C2PA
router.post("/sign", requireAuth, requireScope('write:manifests'), signLimiter, async (req, res) => {
  // Implementation
});

// Get manifest info
router.get("/:fileId", requireAuth, requireScope('read:manifests'), async (req, res) => {
  // Implementation
});
```

### **Credential Issuance Routes** (`/credentials`) - NEW
```typescript
// Create user storage DID
router.post("/storage-did", requireAuth, requireScope('issue:credentials'), async (req, res) => {
  // Implementation: cheqdStudioService.createUserStorageDid()
});

// Find user storage DID
router.get("/storage-did/:userId", requireAuth, requireScope('read:credentials'), async (req, res) => {
  // Implementation: cheqdStudioService.findUserStorageDid()
});

// Create content registration record
router.post("/content-registration", requireAuth, requireScope('register:content'), async (req, res) => {
  // Implementation: createContentRegistration()
});
```

## 🎭 **Role-Based Access Control**

### **Basic User Role**
```typescript
const basicUserScopes = ['read:files', 'write:files', 'read:storage'];
```
*Note: Basic users cannot list buckets - they can only work with files and storage they have access to*

### **Content Creator Role**
```typescript
const contentCreatorScopes = [
  'read:files', 'write:files', 'delete:files',
  'read:storage', 'write:storage',
  'read:manifests', 'write:manifests',
  'register:content'  // Can register content for C2PA
];
```
*Note: Content creators can manage files, C2PA manifests, and register content but cannot manage buckets*

### **Bucket Manager Role**
```typescript
const bucketManagerScopes = [
  'read:files', 'write:files', 'delete:files',
  'read:buckets', 'write:buckets', 'delete:buckets', 'manage:buckets',
  'read:storage', 'write:storage',
  'read:manifests', 'write:manifests',
  'read:profile',
  'register:content'  // Can register content
];
```
*Note: Bucket managers can list and manage buckets, plus all content creator permissions*

### **Credential Issuer Role** - NEW
```typescript
const credentialIssuerScopes = [
  'read:files', 'write:files',
  'read:storage', 'write:storage',
  'read:manifests', 'write:manifests',
  'issue:credentials',  // Can create storage DIDs
  'read:credentials',   // Can read credential information
  'register:content'    // Can register content
];
```
*Note: Credential issuers can create DIDs and register content but cannot manage buckets*

### **Admin Role**
```typescript
const adminScopes = [
  'read:files', 'write:files', 'delete:files',
  'read:buckets', 'write:buckets', 'delete:buckets', 'manage:buckets',
  'read:storage', 'write:storage',
  'read:manifests', 'write:manifests',
  'read:profile', 'write:profile',
  'issue:credentials', 'read:credentials',
  'register:content',
  'admin:users', 'admin:system', 'admin:audit'
];
```
*Note: Admins have full system access including user management and credential issuance*

## 🔒 **Fine-Grained Permission Examples**

### **Conditional Scope Checking**
```typescript
router.post("/upload", requireAuth, async (req, res) => {
  // Check if user can upload to this specific bucket
  if (!hasScope(req, 'write:files')) {
    res.status(403).json({ error: 'Insufficient file write permissions' });
    return;
  }

  // Check if user can access this storage DID
  if (!hasScope(req, 'write:storage')) {
    res.status(403).json({ error: 'Insufficient storage permissions' });
    return;
  }

  // Proceed with upload
  // Implementation...
});
```

### **Credential Issuance Operations**
```typescript
router.post("/storage-did", requireAuth, async (req, res) => {
  // Check if user can issue credentials
  if (!hasScope(req, 'issue:credentials')) {
    res.status(403).json({ error: 'Insufficient credential issuance permissions' });
    return;
  }

  // Create storage DID
  const storageDid = await cheqdStudioService.createUserStorageDid(req.auth.sub);
  res.json({ storageDid });
});
```

### **Content Registration Operations**
```typescript
router.post("/content-registration", requireAuth, async (req, res) => {
  // Check if user can register content
  if (!hasScope(req, 'register:content')) {
    res.status(403).json({ error: 'Insufficient content registration permissions' });
    return;
  }

  // Register content on blockchain
  const result = await createContentRegistration(req.body, req.body.mnemonicId);
  res.json({ result });
});
```

### **Admin-Only Operations**
```typescript
router.get("/admin/users", requireAuth, requireScope('admin:users'), async (req, res) => {
  // List all users (admin only)
  // Implementation...
});

router.post("/admin/cleanup", requireAuth, requireScope('admin:system'), async (req, res) => {
  // System-wide cleanup (admin only)
  // Implementation...
});
```

## 📝 **Environment Configuration**

### **Development Environment**
```bash
LOGTO_REQUIRED_SCOPES=read:files,write:files,read:storage,write:storage,read:manifests,write:manifests,register:content
```

### **Production Environment**
```bash
LOGTO_REQUIRED_SCOPES=read:files,write:files,delete:files,read:storage,write:storage,read:manifests,write:manifests,read:profile,register:content
```

### **Credential Issuer Environment**
```bash
LOGTO_REQUIRED_SCOPES=read:files,write:files,read:storage,write:storage,read:manifests,write:manifests,issue:credentials,read:credentials,register:content
```

### **Admin Environment**
```bash
LOGTO_REQUIRED_SCOPES=read:files,write:files,delete:files,read:buckets,write:buckets,delete:buckets,manage:buckets,read:storage,write:storage,read:manifests,write:manifests,read:profile,write:profile,issue:credentials,read:credentials,register:content,admin:users,admin:system,admin:audit
```

## 🚀 **Implementation Steps**

1. **Add scopes to Logto Admin Console**
   - Go to your Logto Admin Console
   - Navigate to API Resources
   - Add the scopes listed above to your API resource

2. **Update environment variables**
   - Set `LOGTO_REQUIRED_SCOPES` with appropriate scopes for your environment

3. **Update route handlers**
   - Add `requireScope()` middleware to existing routes
   - Use `hasScope()` for conditional permission checking

4. **Test permissions**
   - Verify that users with different scopes can access appropriate endpoints
   - Ensure unauthorized access is properly blocked

## 🔐 **Security Benefits**

- **Basic users** can only work with files and storage - no bucket visibility
- **Content creators** can manage files, C2PA, and register content but not buckets
- **Credential issuers** can create DIDs and register content but not manage buckets
- **Bucket managers** can see and manage buckets plus all content operations
- **Admins** have full system access including user management and credential issuance
- **Bucket listing** is restricted to admins and bucket managers only
- **Credential issuance** is restricted to authorized roles only
