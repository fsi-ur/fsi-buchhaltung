-- Schema initialization for fsi-buchhaltung
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  calendar_token_hash CHAR(64) NULL,
  calendar_token_created_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(31) NOT NULL UNIQUE,
  name VARCHAR(127) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  PRIMARY KEY (user_id, permission_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY (token_hash)
);

CREATE TABLE IF NOT EXISTS entity_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(128) NOT NULL,
  record_key VARCHAR(512) NOT NULL,
  primary_key_json LONGTEXT NOT NULL,
  operation VARCHAR(16) NOT NULL,
  state LONGTEXT NULL,
  changed_by BIGINT UNSIGNED NULL,
  changed_by_username VARCHAR(255) NULL,
  changed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  change_group_id CHAR(36) NULL,
  INDEX idx_entity_versions_lookup (table_name, record_key, id),
  INDEX idx_entity_versions_changed_at (changed_at),
  INDEX idx_entity_versions_changed_by (changed_by),
  INDEX idx_entity_versions_change_group (change_group_id, id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(127) NOT NULL PRIMARY KEY,
  setting_value TEXT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(63) NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(127) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT
);

CREATE TABLE IF NOT EXISTS position_permissions (
  position_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  PRIMARY KEY (position_id, permission_key),
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account BIGINT UNSIGNED,
  last_name VARCHAR(127) NOT NULL,
  first_name VARCHAR(127) NOT NULL,
  birthdate DATE NOT NULL,
  street VARCHAR(255) NOT NULL,
  street_number VARCHAR(20) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  city VARCHAR(127) NOT NULL,
  subject BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(63) NOT NULL,
  email VARCHAR(255) NOT NULL,
  notes TEXT,
  status VARCHAR(31) NOT NULL,
  honorary TINYINT(1) NOT NULL DEFAULT 0,
  applied_at DATE NOT NULL,
  joined_at DATE NOT NULL,
  left_at DATE,
  FOREIGN KEY (account) REFERENCES users(id),
  FOREIGN KEY (subject) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS member_self_edit_field_config (
  field_name VARCHAR(63) NOT NULL PRIMARY KEY,
  mode VARCHAR(16) NOT NULL DEFAULT 'locked'
);

CREATE TABLE IF NOT EXISTS member_pending_field_changes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  member_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(63) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  UNIQUE KEY uq_member_field (member_id, field_name)
);

CREATE TABLE IF NOT EXISTS member_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  member_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL,
  since DATE NOT NULL,
  until DATE,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  street VARCHAR(255),
  street_number VARCHAR(20),
  postal_code VARCHAR(20),
  city VARCHAR(127),
  country VARCHAR(127) DEFAULT 'DE',
  iban VARCHAR(34),
  bic VARCHAR(11),
  bankname VARCHAR(127),
  vat_id VARCHAR(63),
  email VARCHAR(255),
  phone VARCHAR(63),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS association_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  singleton_key TINYINT UNSIGNED NOT NULL DEFAULT 1 UNIQUE,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(127),
  street VARCHAR(255) NOT NULL,
  street_number VARCHAR(20) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  city VARCHAR(127) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(63),
  website VARCHAR(255),
  vat_id VARCHAR(63),
  iban VARCHAR(34),
  bic VARCHAR(11),
  bankname VARCHAR(127),
  register_number VARCHAR(127),
  register_court VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS association_responsible_members (
  association_profile_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (association_profile_id, member_id),
  FOREIGN KEY (association_profile_id) REFERENCES association_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS association_responsible_positions (
  association_profile_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (association_profile_id, position_id),
  FOREIGN KEY (association_profile_id) REFERENCES association_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS files (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_path VARCHAR(511) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(127) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS file_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(63) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  attached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attached_by BIGINT UNSIGNED NOT NULL,
  detached_at TIMESTAMP NULL,
  detached_by BIGINT UNSIGNED NULL,
  FOREIGN KEY (detached_by) REFERENCES users(id),
  FOREIGN KEY (attached_by) REFERENCES users(id),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  source_type VARCHAR(31) NOT NULL,
  is_kleinunternehmer BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  paid_at DATE NULL,
  contact_person VARCHAR(255) NULL,
  service_date DATE NULL,
  invoice_number VARCHAR(127) NOT NULL UNIQUE,
  subject VARCHAR(255) NULL,
  intro_text TEXT NULL,
  notes TEXT NULL,
  status VARCHAR(31) NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS cost_centres (
  id MEDIUMINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT,
  parent_id MEDIUMINT UNSIGNED NULL,
  FOREIGN KEY (parent_id) REFERENCES cost_centres(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT NULL,
  UNIQUE KEY uq_budget_period (start_date, end_date)
);

CREATE TABLE IF NOT EXISTS budget_cost_centre_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  budget_id BIGINT UNSIGNED NOT NULL,
  cost_centre_id MEDIUMINT UNSIGNED NOT NULL,
  expense_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  income_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  UNIQUE KEY uq_budget_cost_centre_line (budget_id, cost_centre_id),
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
  FOREIGN KEY (cost_centre_id) REFERENCES cost_centres(id)
);

CREATE TABLE IF NOT EXISTS subdivisions (
  id MEDIUMINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT
);

CREATE TABLE IF NOT EXISTS subdivision_members (
  subdivision_id MEDIUMINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (subdivision_id, member_id),
  FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  location VARCHAR(255) NULL,
  expected_guests MEDIUMINT UNSIGNED NULL
);

CREATE TABLE IF NOT EXISTS event_member_organizers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY unique_event_member_organizer (event_id, member_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS event_subdivision_organizers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  subdivision_id MEDIUMINT UNSIGNED NOT NULL,
  UNIQUE KEY unique_event_subdivision_organizer (event_id, subdivision_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id)
);

CREATE TABLE IF NOT EXISTS event_shift_slots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  required_people SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_shift_templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  required_people SMALLINT UNSIGNED NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS event_shift_type_descriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  name_key VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  UNIQUE KEY unique_event_shift_type (event_id, name_key),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_shift_members (
  shift_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (shift_id, member_id),
  FOREIGN KEY (shift_id) REFERENCES event_shift_slots(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_checklist_templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_checklist_template_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(255) NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  FOREIGN KEY (template_id) REFERENCES event_checklist_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  deadline VARCHAR(20) NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_task_members (
  task_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (task_id, member_id),
  FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_task_subdivisions (
  task_id BIGINT UNSIGNED NOT NULL,
  subdivision_id MEDIUMINT UNSIGNED NOT NULL,
  PRIMARY KEY (task_id, subdivision_id),
  FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_checklists (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  UNIQUE KEY uq_checklist_task (task_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_checklist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checklist_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(255) NOT NULL,
  is_done TINYINT(1) NOT NULL DEFAULT 0,
  position SMALLINT UNSIGNED NOT NULL,
  FOREIGN KEY (checklist_id) REFERENCES event_checklists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spheres (
  id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(127) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT
);

CREATE TABLE IF NOT EXISTS event_cost_centre_splits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  sphere_id TINYINT UNSIGNED NOT NULL,
  cost_centre_id MEDIUMINT UNSIGNED NOT NULL,
  allocation_percentage DECIMAL(7,2) NOT NULL,
  UNIQUE KEY unique_event_cost_centre_split (event_id, cost_centre_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (sphere_id) REFERENCES spheres(id),
  FOREIGN KEY (cost_centre_id) REFERENCES cost_centres(id)
);

CREATE TABLE IF NOT EXISTS invoice_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  sphere TINYINT UNSIGNED NOT NULL,
  cost_centre MEDIUMINT UNSIGNED NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit VARCHAR(31) NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  tax DECIMAL(5,2) NOT NULL DEFAULT 19.00,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (sphere) REFERENCES spheres(id),
  FOREIGN KEY (cost_centre) REFERENCES cost_centres(id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  receipt_date DATE NOT NULL,
  receipt_number VARCHAR(100),
  description TEXT,
  status VARCHAR(15) NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS receipt_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT UNSIGNED NOT NULL,
  sphere TINYINT UNSIGNED NOT NULL,
  cost_centre MEDIUMINT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  tax TINYINT UNSIGNED DEFAULT 19,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (cost_centre) REFERENCES cost_centres(id),
  FOREIGN KEY (sphere) REFERENCES spheres(id)
);

CREATE TABLE IF NOT EXISTS reimbursements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paid_by BIGINT UNSIGNED NOT NULL,
  bankname VARCHAR(127),
  account_holder VARCHAR(255),
  iban VARCHAR(34),
  bic VARCHAR(11),
  advance DECIMAL(10,2) NOT NULL DEFAULT 0,
  cash TINYINT(1) NOT NULL,
  submitted_at TIMESTAMP NOT NULL,
  checked_at TIMESTAMP,
  checked_by BIGINT UNSIGNED,
  disbursed_at TIMESTAMP,
  disbursed_by BIGINT UNSIGNED,
  FOREIGN KEY (paid_by) REFERENCES members(id),
  FOREIGN KEY (checked_by) REFERENCES members(id),
  FOREIGN KEY (disbursed_by) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS reimbursement_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reimbursement_id BIGINT UNSIGNED NOT NULL,
  receipt_id BIGINT UNSIGNED NOT NULL,
  FOREIGN KEY (reimbursement_id) REFERENCES reimbursements(id) ON DELETE CASCADE,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS cash_counts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NULL,
  counted_by_first BIGINT UNSIGNED NOT NULL,
  counted_by_second BIGINT UNSIGNED NOT NULL,
  checked_by BIGINT UNSIGNED NOT NULL,
  counted_before_at TIMESTAMP NULL,
  counted_after_at TIMESTAMP NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (counted_by_first) REFERENCES members(id),
  FOREIGN KEY (counted_by_second) REFERENCES members(id),
  FOREIGN KEY (checked_by) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS cash_count_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cash_count_id BIGINT UNSIGNED NOT NULL,
  register_number SMALLINT UNSIGNED NOT NULL,
  amount_before DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_after DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (cash_count_id) REFERENCES cash_counts(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cash_count_register (cash_count_id, register_number)
);

CREATE TABLE IF NOT EXISTS bank_statements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  statement_number VARCHAR(50) NOT NULL,
  checked_by BIGINT UNSIGNED NOT NULL,
  statement_date TIMESTAMP NOT NULL,
  FOREIGN KEY (checked_by) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS bank_statement_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bank_statement_id BIGINT UNSIGNED NOT NULL,
  position_type ENUM('receipt','invoice','event') NOT NULL,
  position_date DATE NOT NULL,
  receipt_id BIGINT UNSIGNED NULL,
  invoice_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  amount DECIMAL(10,2) NULL,
  notes TEXT NULL,
  UNIQUE KEY uq_bsp_receipt (receipt_id),
  UNIQUE KEY uq_bsp_invoice (invoice_id),
  FOREIGN KEY (bank_statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type_key VARCHAR(63) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  scheduled_for DATETIME NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  recipient_rule TEXT NOT NULL,
  channels VARCHAR(127) NULL,
  payload TEXT NULL,
  subject_override VARCHAR(255) NULL,
  body_override TEXT NULL,
  link_page VARCHAR(63) NULL,
  link_meta VARCHAR(255) NULL,
  dedupe_key VARCHAR(191) NULL,
  UNIQUE KEY uq_notification_dedupe (dedupe_key),
  KEY idx_notification_due (status, scheduled_for),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notification_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  channel VARCHAR(20) NOT NULL,
  address VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  subject VARCHAR(255) NULL,
  body TEXT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  sent_at DATETIME NULL,
  read_at DATETIME NULL,
  error VARCHAR(500) NULL,
  unsubscribe_token CHAR(64) NULL,
  KEY idx_delivery_inbox (user_id, channel, read_at, id),
  KEY idx_delivery_retry (status, next_attempt_at),
  UNIQUE KEY uq_delivery (notification_id, channel, member_id, user_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_type VARCHAR(10) NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  type_key VARCHAR(63) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  enabled TINYINT(1) NOT NULL,
  UNIQUE KEY uq_preference (subject_type, subject_id, type_key, channel)
);

CREATE TABLE IF NOT EXISTS notification_push_subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_push_endpoint (endpoint),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_spaces (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  icon VARCHAR(100) NOT NULL DEFAULT 'material-symbols:menu-book-rounded',
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  requires_review TINYINT(1) NOT NULL DEFAULT 0,
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  owner_position_id BIGINT UNSIGNED NULL,
  owner_subdivision_id MEDIUMINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_subdivision_id) REFERENCES subdivisions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wiki_articles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  space_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  slug VARCHAR(120) NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '',
  icon VARCHAR(100) NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('draft','in_review','published','archived') NOT NULL DEFAULT 'draft',
  content_md MEDIUMTEXT NULL,
  content_html MEDIUMTEXT NULL,
  content_text MEDIUMTEXT NULL,
  draft_md MEDIUMTEXT NULL,
  draft_updated_at TIMESTAMP NULL,
  draft_updated_by BIGINT UNSIGNED NULL,
  review_interval_days SMALLINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  published_at TIMESTAMP NULL,
  owner_position_id BIGINT UNSIGNED NULL,
  owner_subdivision_id MEDIUMINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wiki_article_slug (space_id, slug),
  KEY idx_wiki_article_parent (parent_id),
  FULLTEXT KEY ft_wiki_article (title, summary, content_text),
  FOREIGN KEY (space_id) REFERENCES wiki_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (draft_updated_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id),
  FOREIGN KEY (owner_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_subdivision_id) REFERENCES subdivisions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wiki_access_grants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope_type ENUM('space','article') NOT NULL,
  scope_id BIGINT UNSIGNED NOT NULL,
  include_descendants TINYINT(1) NOT NULL DEFAULT 1,
  subject_type ENUM('user','role','position','subdivision','permission') NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  subject_key VARCHAR(100) NOT NULL DEFAULT '',
  access_level ENUM('read','write','admin') NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wiki_grant (scope_type, scope_id, subject_type, subject_id, subject_key, access_level),
  KEY idx_wiki_grant_scope (scope_type, scope_id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wiki_tags (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(60) NOT NULL UNIQUE,
  label VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_article_tags (
  article_id BIGINT UNSIGNED NOT NULL,
  tag_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES wiki_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_article_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  article_id BIGINT UNSIGNED NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '',
  content_md MEDIUMTEXT NOT NULL,
  change_note VARCHAR(300) NOT NULL DEFAULT '',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wiki_revision (article_id, revision_number),
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wiki_paths (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  icon VARCHAR(100) NOT NULL DEFAULT 'material-symbols:hiking-rounded',
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wiki_path_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  path_id BIGINT UNSIGNED NOT NULL,
  article_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  note VARCHAR(300) NOT NULL DEFAULT '',
  FOREIGN KEY (path_id) REFERENCES wiki_paths(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_path_audiences (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  path_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NULL,
  subdivision_id MEDIUMINT UNSIGNED NULL,
  FOREIGN KEY (path_id) REFERENCES wiki_paths(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
  FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_path_progress (
  user_id BIGINT UNSIGNED NOT NULL,
  path_item_id BIGINT UNSIGNED NOT NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, path_item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (path_item_id) REFERENCES wiki_path_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_checklists (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  article_id BIGINT UNSIGNED NOT NULL,
  key_slug VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  mode ENUM('personal','shared') NOT NULL DEFAULT 'personal',
  UNIQUE KEY uq_wiki_checklist (article_id, key_slug),
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_checklist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checklist_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(300) NOT NULL,
  hint VARCHAR(500) NOT NULL DEFAULT '',
  target_page VARCHAR(80) NULL,
  target_meta TEXT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  FOREIGN KEY (checklist_id) REFERENCES wiki_checklists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_checklist_personal_state (
  user_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES wiki_checklist_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_checklist_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checklist_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  due_date DATE NULL,
  closed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_id) REFERENCES wiki_checklists(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wiki_checklist_run_state (
  run_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_by BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (run_id, item_id),
  FOREIGN KEY (run_id) REFERENCES wiki_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES wiki_checklist_items(id) ON DELETE CASCADE,
  FOREIGN KEY (completed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wiki_glossary_terms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term VARCHAR(120) NOT NULL UNIQUE,
  short_definition VARCHAR(500) NOT NULL,
  article_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wiki_glossary_aliases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id BIGINT UNSIGNED NOT NULL,
  alias VARCHAR(120) NOT NULL UNIQUE,
  FOREIGN KEY (term_id) REFERENCES wiki_glossary_terms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_page_help (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  page_name VARCHAR(80) NOT NULL,
  section_key VARCHAR(80) NOT NULL DEFAULT '',
  article_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_wiki_page_help (page_name, section_key, article_id),
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wiki_article_views (
  user_id BIGINT UNSIGNED NOT NULL,
  article_id BIGINT UNSIGNED NOT NULL,
  last_viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  view_count INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, article_id),
  KEY idx_wiki_view_recent (user_id, last_viewed_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointment_types (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(127) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#3b82f6',
  icon VARCHAR(127) NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type_id SMALLINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  agenda MEDIUMTEXT NULL,
  location VARCHAR(255) NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  all_day TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  recurrence_freq ENUM('daily','weekly','monthly') NULL,
  recurrence_interval TINYINT UNSIGNED NOT NULL DEFAULT 1,
  recurrence_weekdays VARCHAR(32) NULL,
  recurrence_monthly_mode ENUM('day_of_month','weekday_of_month') NULL,
  recurrence_until DATE NULL,
  recurrence_count SMALLINT UNSIGNED NULL,
  notify_on_create TINYINT(1) NOT NULL DEFAULT 1,
  notify_on_change TINYINT(1) NOT NULL DEFAULT 1,
  notify_reminder TINYINT(1) NOT NULL DEFAULT 1,
  reminder_lead_minutes VARCHAR(64) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_appointments_starts_at (starts_at),
  FOREIGN KEY (type_id) REFERENCES appointment_types(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS appointment_occurrence_overrides (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  occurrence_date DATETIME NOT NULL,
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  title VARCHAR(255) NULL,
  agenda MEDIUMTEXT NULL,
  location VARCHAR(255) NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  UNIQUE KEY unique_appointment_occurrence (appointment_id, occurrence_date),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointment_subdivisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  subdivision_id MEDIUMINT UNSIGNED NOT NULL,
  UNIQUE KEY unique_appointment_subdivision (appointment_id, subdivision_id),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id)
);

CREATE TABLE IF NOT EXISTS appointment_members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY unique_appointment_member (appointment_id, member_id),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS appointment_responses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  occurrence_date DATETIME NOT NULL,
  response ENUM('yes','no','maybe') NOT NULL,
  comment VARCHAR(255) NULL,
  responded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_appointment_response (appointment_id, member_id, occurrence_date),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS association_documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(191) NOT NULL,
  description VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS entity_documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_entity_document (entity_type, entity_id, document_id),
  KEY idx_entity_documents_document (document_id),
  FOREIGN KEY (document_id) REFERENCES association_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
