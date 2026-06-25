"""
HIPAA-Compliant Data Encryption Template

Implementation patterns for encrypting health data at rest and in transit,
with proper key management and audit trails for HIPAA compliance.

Requirements:
- cryptography>=41.0.0
- boto3>=1.26.0 (for AWS KMS integration)
- sqlalchemy>=2.0.0
- pydantic>=2.0.0

Usage:
1. Configure encryption keys (preferably using AWS KMS or HSM)
2. Use PHIEncryption class for sensitive health data
3. Apply EncryptedPHIField for SQLAlchemy models
4. Implement audit logging for all encryption/decryption operations
"""

import os
import json
import base64
import hashlib
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Union
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
import boto3
from sqlalchemy import TypeDecorator, Text, event
from sqlalchemy.ext.declarative import declarative_base
from pydantic import BaseModel, Field
import logging

# =============================================================================
# Configuration and Constants
# =============================================================================

class EncryptionConfig:
    """Configuration for HIPAA-compliant encryption"""

    # Encryption standards
    ALGORITHM = "AES-256-GCM"
    KEY_SIZE = 32  # 256 bits
    IV_SIZE = 12   # 96 bits for GCM
    TAG_SIZE = 16  # 128 bits for GCM

    # Key derivation
    PBKDF2_ITERATIONS = 600000  # NIST recommended minimum
    SALT_SIZE = 16

    # AWS KMS configuration
    AWS_KMS_KEY_ID = os.getenv('HIPAA_KMS_KEY_ID')
    AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')

    # Environment-based key (fallback - use KMS in production)
    MASTER_KEY = os.getenv('HIPAA_MASTER_KEY')

# =============================================================================
# Audit Logging for Encryption Operations
# =============================================================================

class EncryptionAuditLogger:
    """Audit logger for HIPAA compliance - logs all encryption operations"""

    def __init__(self):
        self.logger = logging.getLogger('hipaa_encryption_audit')
        self.logger.setLevel(logging.INFO)

        # Create audit log handler
        handler = logging.FileHandler('hipaa_encryption_audit.log')
        formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S UTC'
        )
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)

    def log_encryption(
        self,
        user_id: str,
        data_type: str,
        operation: str,
        success: bool,
        key_id: Optional[str] = None,
        error: Optional[str] = None
    ):
        """Log encryption/decryption operations for audit trail"""

        audit_entry = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'user_id': user_id,
            'data_type': data_type,
            'operation': operation,  # 'ENCRYPT' or 'DECRYPT'
            'success': success,
            'key_id': key_id,
            'error': error
        }

        self.logger.info(json.dumps(audit_entry))

# =============================================================================
# AWS KMS Integration
# =============================================================================

class AWSKMSManager:
    """AWS KMS integration for HIPAA-compliant key management"""

    def __init__(self):
        self.kms_client = boto3.client('kms', region_name=EncryptionConfig.AWS_REGION)
        self.audit_logger = EncryptionAuditLogger()

    def generate_data_key(self, key_id: str, key_spec: str = 'AES_256') -> Dict[str, bytes]:
        """Generate a new data encryption key using KMS"""
        try:
            response = self.kms_client.generate_data_key(
                KeyId=key_id,
                KeySpec=key_spec
            )

            return {
                'plaintext_key': response['Plaintext'],
                'encrypted_key': response['CiphertextBlob']
            }

        except Exception as e:
            self.audit_logger.log_encryption(
                user_id='system',
                data_type='data_key',
                operation='GENERATE',
                success=False,
                key_id=key_id,
                error=str(e)
            )
            raise

    def decrypt_data_key(self, encrypted_key: bytes) -> bytes:
        """Decrypt a data encryption key using KMS"""
        try:
            response = self.kms_client.decrypt(CiphertextBlob=encrypted_key)
            return response['Plaintext']

        except Exception as e:
            self.audit_logger.log_encryption(
                user_id='system',
                data_type='data_key',
                operation='DECRYPT',
                success=False,
                error=str(e)
            )
            raise

# =============================================================================
# PHI Encryption Class
# =============================================================================

class PHIEncryption:
    """HIPAA-compliant encryption for Protected Health Information"""

    def __init__(self, use_kms: bool = True):
        self.use_kms = use_kms and EncryptionConfig.AWS_KMS_KEY_ID
        self.audit_logger = EncryptionAuditLogger()

        if self.use_kms:
            self.kms_manager = AWSKMSManager()
        else:
            # Fallback to environment key (not recommended for production)
            if not EncryptionConfig.MASTER_KEY:
                raise ValueError("HIPAA_MASTER_KEY environment variable required")

    def _generate_key_from_password(self, password: str, salt: bytes) -> bytes:
        """Generate encryption key from password using PBKDF2"""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=EncryptionConfig.KEY_SIZE,
            salt=salt,
            iterations=EncryptionConfig.PBKDF2_ITERATIONS,
            backend=default_backend()
        )
        return kdf.derive(password.encode())

    def encrypt_phi_data(
        self,
        plaintext: Union[str, dict],
        user_id: str,
        data_type: str = 'phi'
    ) -> Dict[str, str]:
        """
        Encrypt PHI data with AES-256-GCM
        Returns encrypted data with metadata for decryption
        """
        try:
            # Convert input to string if needed
            if isinstance(plaintext, dict):
                plaintext_str = json.dumps(plaintext, separators=(',', ':'))
            else:
                plaintext_str = str(plaintext)

            plaintext_bytes = plaintext_str.encode('utf-8')

            if self.use_kms:
                # Use KMS for key management
                key_data = self.kms_manager.generate_data_key(
                    EncryptionConfig.AWS_KMS_KEY_ID
                )
                encryption_key = key_data['plaintext_key']
                encrypted_key = base64.b64encode(key_data['encrypted_key']).decode('ascii')
                key_id = EncryptionConfig.AWS_KMS_KEY_ID
            else:
                # Use environment-based key with salt
                salt = os.urandom(EncryptionConfig.SALT_SIZE)
                encryption_key = self._generate_key_from_password(
                    EncryptionConfig.MASTER_KEY, salt
                )
                encrypted_key = base64.b64encode(salt).decode('ascii')
                key_id = 'environment_key'

            # Generate random IV
            iv = os.urandom(EncryptionConfig.IV_SIZE)

            # Encrypt with AES-256-GCM
            cipher = Cipher(
                algorithms.AES(encryption_key[:EncryptionConfig.KEY_SIZE]),
                modes.GCM(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()
            ciphertext = encryptor.update(plaintext_bytes) + encryptor.finalize()

            # Get authentication tag
            tag = encryptor.tag

            # Create result with all necessary components
            result = {
                'encrypted_data': base64.b64encode(ciphertext).decode('ascii'),
                'iv': base64.b64encode(iv).decode('ascii'),
                'tag': base64.b64encode(tag).decode('ascii'),
                'key_material': encrypted_key,
                'algorithm': EncryptionConfig.ALGORITHM,
                'key_id': key_id,
                'encrypted_at': datetime.now(timezone.utc).isoformat()
            }

            # Calculate and store data hash for integrity verification
            data_hash = hashlib.sha256(plaintext_bytes).hexdigest()
            result['data_hash'] = data_hash

            # Audit log
            self.audit_logger.log_encryption(
                user_id=user_id,
                data_type=data_type,
                operation='ENCRYPT',
                success=True,
                key_id=key_id
            )

            return result

        except Exception as e:
            self.audit_logger.log_encryption(
                user_id=user_id,
                data_type=data_type,
                operation='ENCRYPT',
                success=False,
                error=str(e)
            )
            raise

    def decrypt_phi_data(
        self,
        encrypted_data: Dict[str, str],
        user_id: str,
        data_type: str = 'phi'
    ) -> Union[str, dict]:
        """
        Decrypt PHI data and verify integrity
        """
        try:
            # Extract components
            ciphertext = base64.b64decode(encrypted_data['encrypted_data'])
            iv = base64.b64decode(encrypted_data['iv'])
            tag = base64.b64decode(encrypted_data['tag'])
            key_material = encrypted_data['key_material']
            key_id = encrypted_data.get('key_id', 'unknown')

            # Reconstruct decryption key
            if self.use_kms and key_id != 'environment_key':
                encryption_key = self.kms_manager.decrypt_data_key(
                    base64.b64decode(key_material)
                )
            else:
                # Environment key with salt
                salt = base64.b64decode(key_material)
                encryption_key = self._generate_key_from_password(
                    EncryptionConfig.MASTER_KEY, salt
                )

            # Decrypt with AES-256-GCM
            cipher = Cipher(
                algorithms.AES(encryption_key[:EncryptionConfig.KEY_SIZE]),
                modes.GCM(iv, tag),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()
            plaintext_bytes = decryptor.update(ciphertext) + decryptor.finalize()

            # Verify data integrity if hash is available
            if 'data_hash' in encrypted_data:
                calculated_hash = hashlib.sha256(plaintext_bytes).hexdigest()
                if calculated_hash != encrypted_data['data_hash']:
                    raise ValueError("Data integrity check failed - possible tampering")

            # Convert back to original format
            plaintext_str = plaintext_bytes.decode('utf-8')

            # Try to parse as JSON, otherwise return as string
            try:
                return json.loads(plaintext_str)
            except json.JSONDecodeError:
                return plaintext_str

        except Exception as e:
            self.audit_logger.log_encryption(
                user_id=user_id,
                data_type=data_type,
                operation='DECRYPT',
                success=False,
                key_id=key_id,
                error=str(e)
            )
            raise
        finally:
            # Audit successful decryption
            if 'e' not in locals():
                self.audit_logger.log_encryption(
                    user_id=user_id,
                    data_type=data_type,
                    operation='DECRYPT',
                    success=True,
                    key_id=key_id
                )

# =============================================================================
# SQLAlchemy Encrypted Field Type
# =============================================================================

class EncryptedPHIField(TypeDecorator):
    """SQLAlchemy field type for automatic PHI encryption/decryption"""

    impl = Text
    cache_ok = True

    def __init__(self, user_id_column: str = 'user_id', **kwargs):
        self.user_id_column = user_id_column
        self.phi_encryption = PHIEncryption()
        super().__init__(**kwargs)

    def process_bind_param(self, value, dialect):
        """Encrypt data before storing in database"""
        if value is None:
            return value

        # Get user_id from context (this would need to be set up in your application)
        user_id = getattr(self, '_current_user_id', 'system')

        encrypted_data = self.phi_encryption.encrypt_phi_data(
            plaintext=value,
            user_id=user_id,
            data_type='database_field'
        )

        return json.dumps(encrypted_data)

    def process_result_value(self, value, dialect):
        """Decrypt data after retrieving from database"""
        if value is None:
            return value

        user_id = getattr(self, '_current_user_id', 'system')

        try:
            encrypted_data = json.loads(value)
            return self.phi_encryption.decrypt_phi_data(
                encrypted_data=encrypted_data,
                user_id=user_id,
                data_type='database_field'
            )
        except Exception as e:
            logging.error(f"Failed to decrypt database field: {e}")
            return None

# =============================================================================
# Example Health Data Models
# =============================================================================

Base = declarative_base()

class PatientRecord(Base):
    """Example patient record with encrypted PHI fields"""
    __tablename__ = 'patient_records'

    id = Column(Integer, primary_key=True)
    patient_id = Column(String(50), nullable=False, index=True)

    # Non-encrypted fields
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Encrypted PHI fields
    medical_history = Column(EncryptedPHIField())
    diagnosis_notes = Column(EncryptedPHIField())
    treatment_plan = Column(EncryptedPHIField())
    lab_results = Column(EncryptedPHIField())

    # Metadata for audit
    last_accessed_by = Column(String(100))
    last_accessed_at = Column(DateTime)

# Set up event listener to track access
@event.listens_for(PatientRecord, 'load')
def track_record_access(target, context):
    """Track when PHI records are accessed"""
    target.last_accessed_at = datetime.utcnow()
    # Set current user (would be implemented in your auth system)
    # target.last_accessed_by = get_current_user_id()

# =============================================================================
# Pydantic Models for API
# =============================================================================

class EncryptedHealthData(BaseModel):
    """Pydantic model for encrypted health data API responses"""

    encrypted_data: str = Field(..., description="Base64 encoded encrypted data")
    iv: str = Field(..., description="Base64 encoded initialization vector")
    tag: str = Field(..., description="Base64 encoded authentication tag")
    key_material: str = Field(..., description="Encrypted key material")
    algorithm: str = Field(..., description="Encryption algorithm used")
    key_id: str = Field(..., description="Key identifier")
    encrypted_at: str = Field(..., description="ISO timestamp of encryption")
    data_hash: str = Field(..., description="SHA256 hash for integrity verification")

class PHIEncryptionRequest(BaseModel):
    """Request model for PHI encryption API"""

    data: Union[str, Dict[str, Any]] = Field(..., description="Data to encrypt")
    data_type: str = Field(..., description="Type of health data")
    user_id: str = Field(..., description="User performing encryption")

class PHIDecryptionRequest(BaseModel):
    """Request model for PHI decryption API"""

    encrypted_data: EncryptedHealthData = Field(..., description="Encrypted data object")
    user_id: str = Field(..., description="User performing decryption")

# =============================================================================
# FastAPI Integration Example
# =============================================================================

from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

app = FastAPI()
security = HTTPBearer()
phi_encryption = PHIEncryption()

async def verify_hipaa_authorization(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify user has authorization to access PHI data"""
    # Implement your authorization logic here
    # This should verify the user has proper HIPAA authorization
    token = credentials.credentials
    # Validate token and return user_id
    return "user_id_from_token"

@app.post("/api/phi/encrypt", response_model=EncryptedHealthData)
async def encrypt_phi_endpoint(
    request: PHIEncryptionRequest,
    user_id: str = Depends(verify_hipaa_authorization)
):
    """Encrypt PHI data via API"""
    try:
        encrypted_data = phi_encryption.encrypt_phi_data(
            plaintext=request.data,
            user_id=user_id,
            data_type=request.data_type
        )
        return EncryptedHealthData(**encrypted_data)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Encryption failed: {str(e)}")

@app.post("/api/phi/decrypt")
async def decrypt_phi_endpoint(
    request: PHIDecryptionRequest,
    user_id: str = Depends(verify_hipaa_authorization)
):
    """Decrypt PHI data via API"""
    try:
        decrypted_data = phi_encryption.decrypt_phi_data(
            encrypted_data=request.encrypted_data.dict(),
            user_id=user_id,
            data_type="api_request"
        )
        return {"data": decrypted_data}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")

# =============================================================================
# Key Rotation Utilities
# =============================================================================

class KeyRotationManager:
    """Manages encryption key rotation for HIPAA compliance"""

    def __init__(self):
        self.phi_encryption = PHIEncryption()
        self.audit_logger = EncryptionAuditLogger()

    def rotate_encrypted_data(
        self,
        old_encrypted_data: Dict[str, str],
        user_id: str,
        data_type: str
    ) -> Dict[str, str]:
        """Re-encrypt data with new key"""
        try:
            # Decrypt with old key
            plaintext = self.phi_encryption.decrypt_phi_data(
                old_encrypted_data, user_id, data_type
            )

            # Re-encrypt with current key
            new_encrypted_data = self.phi_encryption.encrypt_phi_data(
                plaintext, user_id, data_type
            )

            self.audit_logger.log_encryption(
                user_id=user_id,
                data_type=data_type,
                operation='KEY_ROTATION',
                success=True
            )

            return new_encrypted_data

        except Exception as e:
            self.audit_logger.log_encryption(
                user_id=user_id,
                data_type=data_type,
                operation='KEY_ROTATION',
                success=False,
                error=str(e)
            )
            raise

# =============================================================================
# Testing and Validation
# =============================================================================

def test_phi_encryption():
    """Test PHI encryption functionality"""
    phi_encryption = PHIEncryption(use_kms=False)  # Use environment key for testing

    # Test data
    test_data = {
        "patient_id": "12345",
        "diagnosis": "Type 2 Diabetes",
        "medications": ["Metformin", "Insulin"],
        "lab_results": {
            "hba1c": 7.2,
            "glucose": 145
        }
    }

    user_id = "test_user"

    # Test encryption
    print("Testing PHI encryption...")
    encrypted = phi_encryption.encrypt_phi_data(test_data, user_id, "test_data")
    print(f"Encrypted successfully: {len(encrypted['encrypted_data'])} bytes")

    # Test decryption
    print("Testing PHI decryption...")
    decrypted = phi_encryption.decrypt_phi_data(encrypted, user_id, "test_data")
    print(f"Decrypted successfully: {decrypted == test_data}")

    # Test integrity
    encrypted['encrypted_data'] = encrypted['encrypted_data'][:-4] + "XXXX"  # Corrupt data
    try:
        phi_encryption.decrypt_phi_data(encrypted, user_id, "test_data")
        print("ERROR: Corrupted data was not detected!")
    except Exception:
        print("SUCCESS: Data corruption detected and prevented")

if __name__ == "__main__":
    # Run tests
    test_phi_encryption()

# =============================================================================
# Usage Examples
# =============================================================================

"""
Example usage in a health application:

# 1. Initialize encryption
phi_encryption = PHIEncryption()

# 2. Encrypt sensitive user health data
user_health_data = {
    "weight": 165,
    "blood_pressure": "120/80",
    "medications": ["Lisinopril"],
    "allergies": ["Penicillin"]
}

encrypted_data = phi_encryption.encrypt_phi_data(
    plaintext=user_health_data,
    user_id="user_12345",
    data_type="user_health_profile"
)

# 3. Store encrypted data in database
# (The encrypted_data dict can be JSON serialized and stored)

# 4. Retrieve and decrypt when authorized
decrypted_data = phi_encryption.decrypt_phi_data(
    encrypted_data=encrypted_data,
    user_id="staff_67890",  # Authorized staff
    data_type="user_health_profile"
)

# 5. Use with SQLAlchemy models
class UserHealthProfile(Base):
    __tablename__ = 'user_health_profiles'

    id = Column(Integer, primary_key=True)
    user_id = Column(String(50), nullable=False)

    # Automatically encrypted fields
    health_conditions = Column(EncryptedPHIField())
    medications = Column(EncryptedPHIField())
    lab_results = Column(EncryptedPHIField())
"""