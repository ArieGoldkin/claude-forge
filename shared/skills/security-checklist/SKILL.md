---
name: security-checklist
description: Security audit — OWASP Top 10 mitigations, authentication patterns, input validation, compliance, automated scanning
effort: medium
keep-coding-instructions: true
paths:
  - "**/*auth*"
  - "**/*security*"
  - "**/*permission*"
  - "**/*.env*"
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---

# Security Checklist

## Overview

This skill provides comprehensive security guidance for building secure applications. Whether performing a security audit, implementing new features, or hardening existing systems, this framework helps identify and mitigate common vulnerabilities.

**When to use this skill:**
- Conducting security audits or reviews
- Implementing authentication and authorization
- Validating and sanitizing user input
- Handling sensitive data (PII, credentials, payment info)
- Ensuring compliance (GDPR, SOC2)
- Preparing for security assessments or penetration tests
- Reviewing third-party dependencies for vulnerabilities

## Quick Security Scan

### Dependency Scanning
```bash
# JavaScript/TypeScript
npm audit

# Python
pip-audit
# or: pip install pip-audit (if not installed)
```

### Critical Threshold
- **BLOCK deployment** if: Critical vulnerabilities > 0 OR High vulnerabilities > 5
- **Document** all vulnerabilities and remediation steps

## Security Principles

### Defense in Depth
- Multiple layers of security controls
- Assume each layer can fail, design redundancy
- Security at database, application, network, and infrastructure levels

### Least Privilege
- Grant minimum permissions necessary
- Separate read/write database accounts
- Service accounts with limited scope

### Fail Securely
- Errors don't expose sensitive information
- Authentication failures don't reveal if user exists
- Rate limiting prevents brute force attacks

### Don't Trust User Input
- **All** input is untrusted until validated
- Validate, sanitize, and escape
- Apply principle to query params, headers, cookies, POST data

---

## OWASP Top 10 (2021 Edition) - Quick Reference

> **Detailed per-item authorization checks, code examples, and testing steps:** [`checklists/owasp-top-10-checklist.md`](${CLAUDE_SKILL_DIR}/checklists/owasp-top-10-checklist.md)

1. **Broken Access Control** - Verify user authorization before resource access
   - Mitigation: Implement RBAC, deny by default, log access failures

2. **Cryptographic Failures** - Use strong encryption and hashing
   - Mitigation: TLS/HTTPS, bcrypt/argon2 for passwords, encrypt PII at rest

3. **Injection** - Prevent SQL injection, command injection, XSS
   - Mitigation: Parameterized queries, input validation, escape output

4. **Insecure Design** - Design security from the start
   - Mitigation: Threat modeling, rate limiting, secure defaults

5. **Security Misconfiguration** - Secure default configurations
   - Mitigation: Disable debug in production, set security headers, update dependencies

6. **Vulnerable Components** - Keep dependencies updated
   - Mitigation: npm audit, pip-audit, Dependabot, regular updates

7. **Authentication Failures** - Strong authentication and session management
   - Mitigation: MFA, strong passwords, secure sessions, rate limiting

8. **Software/Data Integrity Failures** - Verify code and data integrity
   - Mitigation: SRI for CDN scripts, signed commits, package signatures

9. **Security Logging Failures** - Log security events
   - Mitigation: Log auth events, authorization failures, security errors

10. **Server-Side Request Forgery (SSRF)** - Validate URLs
    - Mitigation: URL allowlists, block internal IPs, disable redirects

---

## Authentication Quick Patterns

### Password Security
```python
from argon2 import PasswordHasher

ph = PasswordHasher()
password_hash = ph.hash(password)  # Hashing
ph.verify(password_hash, password)  # Verification
```

### Session Security
```python
# Flask example
app.config['SESSION_COOKIE_SECURE'] = True      # HTTPS only
app.config['SESSION_COOKIE_HTTPONLY'] = True    # No JavaScript access
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'  # CSRF protection
```

**For complete authentication patterns:** See [`checklists/owasp-top-10-checklist.md` §7 (Identification & Authentication Failures)](${CLAUDE_SKILL_DIR}/checklists/owasp-top-10-checklist.md)

---

## Input Validation Quick Patterns

### Allowlist Validation
```python
def validate_sort_column(column):
    allowed = ['name', 'email', 'created_at']
    if column not in allowed:
        raise ValueError("Invalid sort column")
    return column
```

### Sanitization
```python
from markupsafe import escape

content = escape(request.form['content'])
```

**For complete validation patterns:** See [`checklists/owasp-top-10-checklist.md` §3 (Injection)](${CLAUDE_SKILL_DIR}/checklists/owasp-top-10-checklist.md)

---

## Security Headers

```python
@app.after_request
def set_security_headers(response):
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000'
    return response
```

---

## Automated Security Scanning

### Quick Scan Workflow
1. Run dependency scan (`npm audit` or `pip-audit`)
2. Capture exit code (0 = clean, non-zero = vulnerabilities)
3. Count Critical/High/Medium/Low severities
4. Record evidence in context
5. BLOCK if Critical > 0 or High > 5

**For complete scanning guide:** See [`checklists/owasp-top-10-checklist.md` §6 (Vulnerable & Outdated Components)](${CLAUDE_SKILL_DIR}/checklists/owasp-top-10-checklist.md)

---

## Compliance Quick Checklist

### GDPR (European Data)
- [ ] Privacy policy accessible
- [ ] User rights implemented (access, deletion, portability)
- [ ] Lawful basis for processing
- [ ] Breach notification process (72 hours)

### SOC 2 (Security Controls)
- [ ] Access controls with MFA
- [ ] Encryption at rest and in transit
- [ ] Logging and monitoring
- [ ] Incident response plan

---

## Quick Start Security Checklist

When securing an application:

- [ ] All input validated and sanitized
- [ ] SQL injection prevented (parameterized queries)
- [ ] XSS prevented (output encoding)
- [ ] CSRF protection enabled
- [ ] HTTPS enforced (no HTTP in production)
- [ ] Security headers set (CSP, X-Frame-Options, HSTS)
- [ ] Passwords hashed with bcrypt/argon2
- [ ] Rate limiting on sensitive endpoints
- [ ] Authentication required for protected routes
- [ ] Authorization checks on all data access
- [ ] Secrets in environment variables (not code)
- [ ] Dependencies scanned for vulnerabilities (npm audit / pip-audit)
- [ ] Error messages don't leak information
- [ ] Logging enabled for security events
- [ ] MFA available for sensitive operations

---

## Detailed References

- [OWASP Top 10 Detailed Checklist](${CLAUDE_SKILL_DIR}/checklists/owasp-top-10-checklist.md) — per-item authorization checks, code examples (SQL/command/NoSQL injection, argon2 hashing, SSRF, security headers), testing steps, and dependency-scan commands for all 10 categories, plus authentication & session-management patterns (§7).

The GDPR/SOC2 quick checklist above is the compliance guidance shipped with this skill.

---

**Skill Version**: 2.0.1
**Last Updated**: 2026-07-02
