# Logto Variable Mapping - Corrected

## 🔍 **Variable Mismatch Analysis**

You were absolutely right! There was a significant mismatch between the Logto variables used in `ov-vault-agent` and `content-manager`. **Both systems need app credentials to identify themselves to Logto.**

## 📋 **Corrected Variable Mapping**

### **ov-vault-agent Variables** (Client-side OAuth)
```bash
LOGTO_APP_ID=your_app_id
LOGTO_APP_SECRET=your_app_secret
LOGTO_TOKEN_ENDPOINT=https://auth.originvault.box/oidc/token
LOGTO_REDIRECT_URI=http://localhost:4000/auth/callback
LOGTO_ENDPOINT=https://auth.originvault.box
LOGTO_CLIENT_IDS=client1,client2,client3
```

### **content-manager Variables** (Server-side JWT Verification + App Identification)
```bash
# App credentials (REQUIRED to identify the app to Logto)
LOGTO_APP_ID=your_content_manager_app_id
LOGTO_APP_SECRET=your_content_manager_app_secret
LOGTO_TOKEN_ENDPOINT=https://auth.originvault.box/oidc/token
LOGTO_REDIRECT_URI=http://localhost:8080/auth/callback

# Server configuration
LOGTO_ENDPOINT=https://auth.originvault.box
LOGTO_ISSUER=https://auth.originvault.box
LOGTO_JWKS_URI=https://auth.originvault.box/.well-known/jwks.json
LOGTO_ALLOWED_AUDIENCES=ov-public-utility-tool,ov-content-manager
LOGTO_CLIENT_IDS=your_logto_client_ids_here
LOGTO_REQUIRED_SCOPES=read:files,write:files,read:storage,write:storage,read:manifests,write:manifests,register:content

# Alternative variables (for backward compatibility)
LOGTO_BASE_URL=https://auth.originvault.box
LOGTO_ALLOWED_CLIENT_IDS=your_logto_client_ids_here
```

## 🔧 **Key Changes Made**

### **1. Unified Variable Names**
- **`LOGTO_ENDPOINT`** - Now used in both systems (instead of `LOGTO_BASE_URL`)
- **`LOGTO_CLIENT_IDS`** - Now used in both systems (instead of `LOGTO_ALLOWED_CLIENT_IDS`)

### **2. Required App Credentials**
Both systems **NEED** these variables to identify themselves to Logto:
- `LOGTO_APP_ID` - Application identifier
- `LOGTO_APP_SECRET` - Application secret
- `LOGTO_TOKEN_ENDPOINT` - Token endpoint
- `LOGTO_REDIRECT_URI` - Redirect URI (even for server-side apps)

### **3. Backward Compatibility**
The content-manager now supports **both variable names**:
```typescript
// In config.ts
baseUrl: process.env.LOGTO_ENDPOINT || process.env.LOGTO_BASE_URL,
allowedClientIds: (process.env.LOGTO_CLIENT_IDS || process.env.LOGTO_ALLOWED_CLIENT_IDS || "").split(",").filter(Boolean),
```

## 🎯 **Recommended Environment Setup**

### **For content-manager:**
```bash
# App credentials (REQUIRED)
LOGTO_APP_ID=your_content_manager_app_id
LOGTO_APP_SECRET=your_content_manager_app_secret
LOGTO_TOKEN_ENDPOINT=https://auth.originvault.box/oidc/token
LOGTO_REDIRECT_URI=http://localhost:8080/auth/callback

# Server configuration
LOGTO_ENDPOINT=https://auth.originvault.box
LOGTO_ISSUER=https://auth.originvault.box
LOGTO_JWKS_URI=https://auth.originvault.box/.well-known/jwks.json
LOGTO_ALLOWED_AUDIENCES=ov-public-utility-tool,ov-content-manager
LOGTO_CLIENT_IDS=your_logto_client_ids_here
LOGTO_REQUIRED_SCOPES=read:files,write:files,read:storage,write:storage,read:manifests,write:manifests,register:content
```

### **For ov-vault-agent:**
```bash
# App credentials (REQUIRED)
LOGTO_APP_ID=your_app_id
LOGTO_APP_SECRET=your_app_secret
LOGTO_TOKEN_ENDPOINT=https://auth.originvault.box/oidc/token
LOGTO_REDIRECT_URI=http://localhost:4000/auth/callback

# Server configuration
LOGTO_ENDPOINT=https://auth.originvault.box
LOGTO_CLIENT_IDS=client1,client2,client3
```

## ✅ **Result**

Now both systems use **consistent variable naming** and **both have the required app credentials**:
- `LOGTO_ENDPOINT` - Base URL for Logto
- `LOGTO_CLIENT_IDS` - Allowed client IDs
- `LOGTO_APP_ID` & `LOGTO_APP_SECRET` - Required for app identification
- Content-manager supports both old and new variable names for backward compatibility

**Both systems need app credentials to identify themselves to Logto, regardless of whether they're doing client-side OAuth or server-side JWT verification.**
