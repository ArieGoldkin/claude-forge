---
name: hipaa-compliance-checker
description: HIPAA compliance validation — health data handling, API security, data privacy, and security gap identification. Triggers on HIPAA, PHI, health data, compliance check, data privacy, protected health information, BAA
effort: low
keep-coding-instructions: true
paths:
  - "**/*hipaa*"
  - "**/*health*"
  - "**/*phi*"
  - "**/*compliance*"
---

# HIPAA Compliance Checker

## Overview

Validates health data security compliance for healthcare-adjacent applications, ensuring HIPAA-aligned patterns and identifying security vulnerabilities. Applicable to any system handling Protected Health Information (PHI): telemedicine, fitness/health apps, insurance tech, EHR integrations, patient portals.

**Bundled Resources:**
- `${CLAUDE_SKILL_DIR}/references/hipaa-technical-safeguards.md` - Technical security requirements and implementation patterns
- `${CLAUDE_SKILL_DIR}/references/api-security-patterns.md` - Healthcare API security best practices
- `${CLAUDE_SKILL_DIR}/references/frontend-privacy-controls.md` - Client-side security measures for health data
- `${CLAUDE_SKILL_DIR}/references/audit-checklist.md` - Comprehensive compliance validation checklist
- `${CLAUDE_SKILL_DIR}/templates/security-headers-template.js` - HTTP security headers for healthcare applications
- `${CLAUDE_SKILL_DIR}/templates/data-encryption-template.py` - Health data encryption implementation patterns

---

## ⚠ Claude Code Environment Variables — HIPAA Must-Avoid

Before deploying Claude Code in a HIPAA-regulated context, verify these env vars are NOT set:

| Variable | Risk | Why |
|----------|------|-----|
| `OTEL_LOG_RAW_API_BODIES` | **CRITICAL** | CC 2.1.111+: emits full API request/response bodies as OpenTelemetry log events. Every message containing PHI would be exported to whatever observability backend receives OTel events. |
| `DISABLE_TELEMETRY=0` with debug logging | HIGH | Allows transmission of prompt/response payloads to Anthropic telemetry. |

**Required for HIPAA deployments:**
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` — strips Anthropic/cloud credentials from subprocesses (CC 2.1.83+)
- Audit your OpenTelemetry exporter configuration (Jaeger, Datadog, etc.) for retention policies — raw bodies must not be stored
- Use `/config` to verify telemetry settings before each session on protected systems

## Quick Compliance Check

### 1. Data Classification
**Health Information Assessment:**
- Identify PHI (Protected Health Information) in your system
- Classify data sensitivity levels (public, internal, confidential, restricted)
- Document data flows and storage locations
- Map data lifecycle and retention requirements

### 2. Technical Safeguards Validation
**Core Security Controls:**
- Access controls and authentication mechanisms
- Audit logging and monitoring systems
- Data encryption (at rest and in transit)
- Network security and transmission safeguards

**Read `${CLAUDE_SKILL_DIR}/references/hipaa-technical-safeguards.md` for detailed implementation requirements.**

### 3. API Security Assessment
**Healthcare API Requirements:**
- Authentication and authorization patterns
- Input validation and sanitization
- Rate limiting and DDoS protection
- Secure data transmission protocols

**Read `${CLAUDE_SKILL_DIR}/references/api-security-patterns.md` for comprehensive API security guidance.**

### 4. Frontend Privacy Controls
**Client-Side Security Measures:**
- Data masking and progressive disclosure
- Session management and timeout controls
- Secure storage practices
- Privacy-preserving UI patterns

**Read `${CLAUDE_SKILL_DIR}/references/frontend-privacy-controls.md` for implementation patterns.**

## Core Compliance Areas

### Access Control & Authentication
- Multi-factor authentication for admin access
- Role-based access control (RBAC) for health data
- Principle of least privilege enforcement
- Regular access reviews and deprovisioning

### Audit & Monitoring
- Comprehensive audit logging for all health data access
- Real-time monitoring and alerting systems
- Log integrity and tamper protection
- Regular security monitoring and incident response

### Data Protection
- End-to-end encryption for health data transmission
- AES-256 encryption for data at rest
- Secure key management and rotation
- Data backup encryption and recovery procedures

### Network Security
- TLS 1.3 for all health data transmission
- Network segmentation and firewall rules
- VPN access for remote healthcare workers
- Regular penetration testing and vulnerability assessments

## Implementation Standards

### Encryption Requirements
- **Data at Rest**: AES-256 encryption for all databases containing PHI
- **Data in Transit**: TLS 1.3 minimum for all API communications
- **Key Management**: HSM or KMS for encryption key storage and rotation
- **Backup Encryption**: Encrypted backups with separate key management

### Access Control Implementation
- **Authentication**: Multi-factor authentication for all admin access
- **Authorization**: Attribute-based access control (ABAC) for fine-grained permissions
- **Session Management**: Secure session handling with automatic timeout
- **API Security**: OAuth 2.0 with PKCE for healthcare API access

### Audit Requirements
- **Comprehensive Logging**: All PHI access, modifications, and deletions
- **Log Integrity**: Cryptographic signatures and tamper detection
- **Retention**: Minimum 6-year audit log retention for HIPAA compliance
- **Monitoring**: Real-time alerts for suspicious access patterns

## Risk Assessment Framework

### High-Risk Areas
- **Patient Data Collection**: Forms, surveys, health assessments
- **Data Transmission**: API calls, file uploads, external integrations
- **Data Storage**: Databases, caches, temporary files, backups
- **Access Management**: User authentication, role assignments, permissions

### Vulnerability Categories
- **Injection Attacks**: SQL injection, NoSQL injection, command injection
- **Authentication Bypass**: Weak passwords, session fixation, privilege escalation
- **Data Exposure**: Information leakage, insufficient encryption, improper access controls
- **Business Logic Flaws**: Workflow bypasses, data validation gaps, authorization failures

## Compliance Validation Process

### 1. Security Assessment
Run comprehensive security analysis using provided templates and checklists

### 2. Technical Review
Validate implementation against HIPAA technical safeguards requirements

### 3. Documentation Audit
Ensure proper security policies, procedures, and training documentation

### 4. Penetration Testing
Conduct security testing to identify vulnerabilities and compliance gaps

## Getting Started

1. **For security audits**: Use `${CLAUDE_SKILL_DIR}/references/audit-checklist.md` for systematic validation
2. **For API security**: Reference `${CLAUDE_SKILL_DIR}/references/api-security-patterns.md` and implement `${CLAUDE_SKILL_DIR}/templates/security-headers-template.js`
3. **For data protection**: Apply patterns from `${CLAUDE_SKILL_DIR}/templates/data-encryption-template.py`
4. **For compliance validation**: Follow `${CLAUDE_SKILL_DIR}/references/hipaa-technical-safeguards.md` requirements

**Remember**: HIPAA compliance is not optional for healthcare applications. Every security control must be implemented correctly to protect patient health information.