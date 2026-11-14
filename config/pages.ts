import type { AppPage } from '~/types/page'
import BankStatementListPage from '~/components/Page/Finances/BankStatement/List.vue'
import BankStatementCreatePage from '~/components/Page/Finances/BankStatement/Create.vue'
import LoginPage from '~/components/Page/Login.vue'
import HomePage from '~/components/Page/Home.vue'
import FinancesPage from '~/components/Page/Finances/Overview.vue'
import ReceiptListPage from '~/components/Page/Finances/Receipt/List.vue'
import ReceiptCreatePage from '~/components/Page/Finances/Receipt/Create.vue'
import InvoiceListPage from '~/components/Page/Finances/Invoice/List.vue'
import InvoiceCreatePage from '~/components/Page/Finances/Invoice/Create.vue'
import ReimbursementListPage from '~/components/Page/Finances/Reimbursement/List.vue'
import ReimbursementCreatePage from '~/components/Page/Finances/Reimbursement/Create.vue'
import CashCountListPage from '~/components/Page/Finances/CashCount/List.vue'
import CashCountCreatePage from '~/components/Page/Finances/CashCount/Create.vue'
import BudgetListPage from '~/components/Page/Finances/Budget/List.vue'
import BudgetCreatePage from '~/components/Page/Finances/Budget/Create.vue'
import SubdivisionLeadershipPage from '~/components/Page/SubdivisionLeadership/Page.vue'
import EventListPage from '~/components/Page/Events/List.vue'
import EventPlanningWorkspacePage from '~/components/Page/Events/PlanningWorkspace.vue'
import MemberOverviewPage from '~/components/Page/Members/Overview.vue'
import MemberCreatePage from '~/components/Page/Members/Create.vue'
import MemberSelfServicePage from '~/components/Page/Members/SelfService.vue'
import SettingsPage from '~/components/Page/Settings/Overview.vue'
import NotificationListPage from '~/components/Page/Notifications/List.vue'
import NotificationCreatePage from '~/components/Page/Notifications/Create.vue'
import WikiHomePage from '~/components/Page/Wiki/Home.vue'
import WikiArticlePage from '~/components/Page/Wiki/Article/Article.vue'
import WikiArticleEditPage from '~/components/Page/Wiki/Article/Edit.vue'
import WikiPathPage from '~/components/Page/Wiki/Path.vue'
import WikiAdminPage from '~/components/Page/Wiki/Admin/Admin.vue'
import WikiGlossaryPage from '~/components/Page/Wiki/Glossary/Glossary.vue'
import AuditLogPage from '~/components/Page/Audit/Log.vue'
import CalendarPage from '~/components/Page/Calendar/Calendar.vue'
import AppointmentCreatePage from '~/components/Page/Calendar/Create.vue'

// Do not display more than 8 pages at once
export const PAGES: Record<string, AppPage> = {
  Login: { main: true, labelKey: 'pages.login', component: LoginPage, icon: 'material-symbols:login-rounded', permissions: [], allowGuest: true },
  Home: { main: true, labelKey: 'pages.home', component: HomePage, icon: 'material-symbols:home-rounded', permissions: ['pages.home.view'] },
  Finances: { main: true, labelKey: 'pages.finances', component: FinancesPage, icon: 'material-symbols:euro-rounded', permissions: ['receipts.view', 'invoices.view', 'reimbursements.view', 'cash_counts.view', 'budgets.view', 'bank_statements.view'] },
  ReceiptList: { main: false, labelKey: 'pages.receipts', component: ReceiptListPage, permissions: ['receipts.view'] },
  ReceiptCreate: { main: false, labelKey: 'pages.createReceipt', component: ReceiptCreatePage, permissions: ['receipts.view'], preserveOnRefresh: true },
  InvoiceList: { main: false, labelKey: 'pages.invoices', component: InvoiceListPage, permissions: ['invoices.view'] },
  InvoiceCreate: { main: false, labelKey: 'pages.createInvoice', component: InvoiceCreatePage, permissions: ['invoices.view'], preserveOnRefresh: true },
  ReimbursementList: { main: false, labelKey: 'pages.reimbursements', component: ReimbursementListPage, permissions: ['reimbursements.view'] },
  ReimbursementCreate: { main: false, labelKey: 'pages.createReimbursement', component: ReimbursementCreatePage, permissions: ['reimbursements.view'], preserveOnRefresh: true },
  CashCountList: { main: false, labelKey: 'pages.cashCounts', component: CashCountListPage, permissions: ['cash_counts.view'] },
  CashCountCreate: { main: false, labelKey: 'pages.createCashCount', component: CashCountCreatePage, permissions: ['cash_counts.view'], preserveOnRefresh: true },
  BudgetList: { main: false, labelKey: 'pages.budgets', component: BudgetListPage, permissions: ['budgets.view'] },
  BudgetCreate: { main: false, labelKey: 'pages.createBudget', component: BudgetCreatePage, permissions: ['budgets.view'], preserveOnRefresh: true },
  Events: { main: true, labelKey: 'pages.events', component: EventListPage, icon: 'material-symbols:event-rounded', permissions: ['events.access'] },
  EventCreate: { main: false, labelKey: 'pages.createEvent', component: EventPlanningWorkspacePage, permissions: ['events.access'], preserveOnRefresh: true },
  MemberList: { main: true, labelKey: 'pages.members', component: MemberOverviewPage, icon: 'material-symbols:groups-rounded', permissions: ['members.view', 'members.approveChanges', 'members.configureSelfEditFields'] },
  SubdivisionLeadership: { main: true, labelKey: 'pages.subdivisionLeadership', component: SubdivisionLeadershipPage, icon: 'material-symbols:supervisor-account-rounded', permissions: ['subdivisions.leadership.view'], allowSubdivisionLeaders: true },
  MemberCreate: { main: false, labelKey: 'pages.createMember', component: MemberCreatePage, permissions: ['members.view'], preserveOnRefresh: true },
  MemberSelfService: { main: true, labelKey: 'pages.myData', component: MemberSelfServicePage, icon: 'material-symbols:person-rounded', permissions: ['members.editOwnData'] },
  Settings: { main: true, labelKey: 'pages.settings', component: SettingsPage, icon: 'material-symbols:settings-rounded', permissions: ['settings.access'], preserveOnRefresh: true },
  BankStatementList: { main: false, labelKey: 'pages.bankStatements', component: BankStatementListPage, permissions: ['bank_statements.view'] },
  BankStatementCreate: { main: false, labelKey: 'pages.createBankStatement', component: BankStatementCreatePage, permissions: ['bank_statements.view'], preserveOnRefresh: true },
  NotificationList: { main: false, labelKey: 'pages.notifications', component: NotificationListPage, permissions: [] },
  NotificationCreate: { main: false, labelKey: 'pages.createNotification', component: NotificationCreatePage, permissions: ['notifications.send'], preserveOnRefresh: true },
  Wiki: { main: true, labelKey: 'pages.wiki', component: WikiHomePage, icon: 'material-symbols:menu-book-rounded', permissions: ['wiki.view'] },
  WikiArticle: { main: false, labelKey: 'pages.wikiArticle', component: WikiArticlePage, permissions: ['wiki.view'], preserveOnRefresh: true },
  WikiArticleEdit: { main: false, labelKey: 'pages.wikiArticleEdit', component: WikiArticleEditPage, permissions: ['wiki.view'], preserveOnRefresh: true },
  WikiPath: { main: false, labelKey: 'pages.wikiPath', component: WikiPathPage, permissions: ['wiki.view'], preserveOnRefresh: true },
  WikiGlossary: { main: false, labelKey: 'pages.wikiGlossary', component: WikiGlossaryPage, permissions: ['wiki.view'], preserveOnRefresh: true },
  WikiAdmin: { main: false, labelKey: 'pages.wikiAdmin', component: WikiAdminPage, permissions: ['wiki.manage'], preserveOnRefresh: true },
  AuditLog: { main: false, labelKey: 'pages.auditLog', component: AuditLogPage, permissions: ['audit.view'] },
  Calendar: { main: false, labelKey: 'pages.calendar', component: CalendarPage, permissions: ['calendar.view'], preserveOnRefresh: true },
  AppointmentCreate: { main: false, labelKey: 'pages.createAppointment', component: AppointmentCreatePage, permissions: ['calendar.create'], preserveOnRefresh: true },
}
