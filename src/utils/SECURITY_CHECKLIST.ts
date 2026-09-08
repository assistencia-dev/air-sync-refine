/**
 * SECURITY CHECKLIST & DEPLOYMENT GUIDE
 * ============================================================================
 * 
 * Before publishing to production, verify all security controls are in place.
 * This checklist ensures the RH module meets enterprise security standards.
 * 
 * ============================================================================
 */

// ============================================================================
// PRE-DEPLOYMENT SECURITY CHECKLIST
// ============================================================================

export const SECURITY_CHECKLIST = {
  // 1. DATABASE SECURITY
  database: {
    "RLS Enabled on rh_employees": {
      status: "CRITICAL",
      description: "Row Level Security must be enabled on rh_employees table",
      verification: "SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE tablename = 'rh_employees'",
      command: "ALTER TABLE public.rh_employees ENABLE ROW LEVEL SECURITY;",
      docs: "docs/SECURITY_RLS_HARDENING.sql",
    },
    "RLS Enabled on rh_benefit_requests": {
      status: "CRITICAL",
      description: "Row Level Security must be enabled on rh_benefit_requests table",
      verification: "SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE tablename = 'rh_benefit_requests'",
      command: "ALTER TABLE public.rh_benefit_requests ENABLE ROW LEVEL SECURITY;",
    },
    "RLS Policies Enforced": {
      status: "CRITICAL",
      description: "RLS policies must enforce role-based access control",
      verification: "SELECT * FROM pg_policies WHERE tablename IN ('rh_employees', 'rh_benefit_requests')",
      command: "Run docs/SECURITY_RLS_HARDENING.sql in Supabase SQL Editor",
    },
    "Foreign Key Constraints": {
      status: "HIGH",
      description: "Foreign keys protect referential integrity",
      verification: "\\d rh_employees (check REFERENCES column)",
      example: "ALTER TABLE public.rh_employees ADD CONSTRAINT fk_unit FOREIGN KEY (unit) REFERENCES public.units(name) ON DELETE RESTRICT;",
    },
  },

  // 2. AUTHENTICATION & AUTHORIZATION
  auth: {
    "Service Role Key Never in Frontend": {
      status: "CRITICAL",
      description: "Supabase service_role key must NEVER be exposed in client code",
      verification: "Grep for 'service_role' or 'SUPABASE_SERVICE_ROLE' in src/",
      fix: "All server-side operations must use Supabase client library with auth context",
    },
    "Public Anonymous Key Only in Frontend": {
      status: "CRITICAL",
      description: "Only ANON key should be in frontend .env files",
      verification: "Check .env.local contains VITE_SUPABASE_ANON_KEY, NOT service role key",
      example: "VITE_SUPABASE_ANON_KEY=eyJ0eXAiOiJKV1QiLCJhbGc...",
    },
    "JWT Secrets Rotated": {
      status: "HIGH",
      description: "Supabase JWT secrets should be rotated regularly (quarterly minimum)",
      verification: "Supabase Dashboard > Settings > API > JWT Secret",
      action: "Schedule quarterly rotation",
    },
    "Role-Based Access Control (RBAC)": {
      status: "CRITICAL",
      description: "All operations must verify user role before executing",
      implementation: "Use auth.uid() and user.role in RLS policies",
      example: "current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')",
    },
  },

  // 3. API & CLIENT SECURITY
  client: {
    "Supabase Client Initialized with Anon Key": {
      status: "CRITICAL",
      description: "Supabase client must use ANON key, never service role",
      file: "src/integrations/supabase/client.ts",
      example: "const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;",
    },
    "No Hardcoded Secrets in Code": {
      status: "CRITICAL",
      description: "All secrets must come from environment variables",
      verification: "grep -r 'sk_live' src/ ; grep -r 'password=' src/",
      fix: "Move all secrets to .env.local (not committed)",
    },
    "Request Validation & Sanitization": {
      status: "HIGH",
      description: "All user input must be validated with Zod before database queries",
      example: "Use zodResolver in react-hook-form for all forms",
      file: "src/components/EmployeeForm.tsx",
    },
    "HTTPS Enforced": {
      status: "CRITICAL",
      description: "All traffic must be encrypted in transit",
      verification: "Production URL must be https://",
      supabase: "Supabase automatically provides HTTPS",
    },
  },

  // 4. DATA PRIVACY & PROTECTION
  privacy: {
    "Sensitive Data Logged": {
      status: "MEDIUM",
      description: "RH data (salaries, personal info) must never be logged in plain text",
      verification: "Audit logs should hash sensitive fields",
      example: "Log only employee_id, not full personal data",
    },
    "Encryption at Rest": {
      status: "HIGH",
      description: "Sensitive tables should have encrypted columns",
      implementation: "Supabase provides automatic encryption at rest for all data",
      verification: "Supabase Dashboard > Database > Encryption Status",
    },
    "Access Logs Audited": {
      status: "HIGH",
      description: "All administrative access must be logged",
      table: "public.audit_log",
      retention: "Keep audit logs for minimum 90 days",
    },
  },

  // 5. DEPENDENCY SECURITY
  dependencies: {
    "js-yaml CVE-2026-59870": {
      status: "HIGH",
      severity: "DoS vulnerability in YAML parsing",
      affected: "@tanstack/react-start",
      fix: "Update @tanstack/react-start to latest version",
      command: "npm audit fix --force",
      verification: "npm audit (should show 0 vulnerabilities)",
    },
    "Regular npm audit": {
      status: "MEDIUM",
      description: "Run npm audit before each deployment",
      command: "npm audit --audit-level=high",
      action: "Fix all HIGH and CRITICAL vulnerabilities",
    },
  },

  // 6. RATE LIMITING & DDoS PROTECTION
  rateLimit: {
    "API Rate Limiting": {
      status: "MEDIUM",
      description: "Implement rate limiting on Supabase functions",
      tool: "Supabase Auth: Rate limiting built-in",
      config: "Configure in Supabase Dashboard > Project Settings",
    },
    "DDoS Protection": {
      status: "MEDIUM",
      description: "Enable Cloudflare or similar CDN for DDoS protection",
      recommendation: "Place Vercel/production behind Cloudflare for extra layer",
    },
  },

  // 7. BACKUP & DISASTER RECOVERY
  backup: {
    "Database Backups": {
      status: "CRITICAL",
      description: "Daily automated backups must be enabled",
      verification: "Supabase Dashboard > Database > Backups",
      retention: "Keep backups for minimum 30 days",
    },
    "Point-in-Time Recovery (PITR)": {
      status: "HIGH",
      description: "Enable PITR for production database",
      supabase: "Available in Supabase Pro plan",
      docs: "https://supabase.com/docs/guides/platform/backups",
    },
  },

  // 8. MONITORING & ALERTING
  monitoring: {
    "Error Tracking": {
      status: "HIGH",
      description: "Configure error tracking (Sentry, LogRocket, etc)",
      implementation: "Add error boundary in React app",
      recommendation: "Use Sentry for production error tracking",
    },
    "Performance Monitoring": {
      status: "MEDIUM",
      description: "Monitor query performance and load times",
      tool: "Supabase Analytics Dashboard",
      metric: "Watch for slow RLS policy queries",
    },
    "Security Alerts": {
      status: "HIGH",
      description: "Set up alerts for suspicious activity",
      examples: [
        "Multiple failed login attempts",
        "Unusual data access patterns",
        "Database connection limit reached",
      ],
    },
  },

  // 9. COMPLIANCE & DOCUMENTATION
  compliance: {
    "LGPD Compliance (Brazil)": {
      status: "CRITICAL",
      description: "Ensure data handling complies with Brazilian LGPD law",
      requirements: [
        "User consent for data collection",
        "Data retention policy (delete after 3 years)",
        "Privacy policy published",
        "Data breach notification procedure",
      ],
      docs: "https://www.gov.br/cidadania/pt-br/acesso-a-informacao/lgpd",
    },
    "Security Policy Documentation": {
      status: "MEDIUM",
      description: "Maintain updated security policy document",
      file: "docs/SECURITY_POLICY.md",
    },
  },

  // 10. INCIDENT RESPONSE
  incident: {
    "Security Incident Response Plan": {
      status: "MEDIUM",
      description: "Define steps for handling security incidents",
      steps: [
        "1. Detect: Monitoring alerts trigger",
        "2. Respond: Investigate root cause",
        "3. Contain: Limit damage (e.g., revoke compromised keys)",
        "4. Notify: Inform affected users if data leaked",
        "5. Remediate: Fix vulnerability",
        "6. Review: Document lessons learned",
      ],
    },
  },
};

// ============================================================================
// DEPLOYMENT CHECKLIST
// ============================================================================

export const DEPLOYMENT_CHECKLIST = [
  {
    phase: "PRE-DEPLOYMENT",
    items: [
      "✓ npm audit shows 0 CRITICAL vulnerabilities",
      "✓ All RLS policies deployed to production database",
      "✓ Environment variables configured (.env.production)",
      "✓ Supabase anon key verified (not service role)",
      "✓ Security Checklist items CRITICAL status completed",
      "✓ Database backups enabled and tested",
      "✓ Rate limiting configured",
      "✓ Error tracking (Sentry) configured",
    ],
  },
  {
    phase: "DEPLOYMENT",
    items: [
      "✓ Run: npm run build (no errors)",
      "✓ Deploy to staging environment first",
      "✓ Run security scan on staging",
      "✓ Test RLS policies (verify access denied for unauthorized users)",
      "✓ Verify audit logs are being created",
      "✓ Test backup restore (in staging)",
    ],
  },
  {
    phase: "POST-DEPLOYMENT",
    items: [
      "✓ Monitor error tracking for first 24h",
      "✓ Check database query performance",
      "✓ Verify rate limiting is working",
      "✓ Review audit logs for any anomalies",
      "✓ Test data access as different roles",
      "✓ Schedule security review meeting",
    ],
  },
];

// ============================================================================
// QUICK REFERENCE: COMMANDS
// ============================================================================

export const DEPLOYMENT_COMMANDS = `
# 1. Verify security dependencies
npm audit

# 2. Build application
npm run build

# 3. Run tests (if available)
npm test

# 4. Deploy to Supabase (execute SQL security script)
# - Open Supabase SQL Editor
# - Copy contents of docs/SECURITY_RLS_HARDENING.sql
# - Execute in production database
# - Verify all policies created successfully

# 5. Verify environment variables in production
# Ensure these are set (check Vercel/production dashboard):
# - VITE_SUPABASE_URL (public)
# - VITE_SUPABASE_ANON_KEY (public)
# - DO NOT set SUPABASE_SERVICE_ROLE_KEY in frontend

# 6. Test RLS policies in production
# Run as authenticated user and verify:
# - Can only see own data
# - Cannot access other users' sensitive fields
`;

// ============================================================================
// CRITICAL VULNERABILITIES TO FIX BEFORE DEPLOYMENT
// ============================================================================

export const CRITICAL_FIXES = [
  {
    issue: "js-yaml DoS vulnerability",
    severity: "HIGH",
    cve: "CVE-2026-59870",
    fix: "npm install @tanstack/react-start@latest",
    verification: "npm audit should show 0 vulnerabilities",
  },
  {
    issue: "No RLS on database tables",
    severity: "CRITICAL",
    fix: "Execute docs/SECURITY_RLS_HARDENING.sql",
    verification: "SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE tablename = 'rh_employees'",
  },
  {
    issue: "Service role key in frontend code",
    severity: "CRITICAL",
    fix: "Remove all references to SUPABASE_SERVICE_ROLE_KEY",
    verification: "grep -r 'service_role' src/",
  },
];

export default SECURITY_CHECKLIST;
