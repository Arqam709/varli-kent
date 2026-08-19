import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { SiteSettingsProvider } from './contexts/SiteSettingsContext'
import { ThemeProvider } from './contexts/ThemeContext'
import PublicLayout from './components/PublicLayout'
import ProtectedRoute from './components/ProtectedRoute'
import ScrollToTop from './components/ScrollToTop'
import PrivacyBanner from './components/PrivacyBanner'
import HomePage from './pages/HomePage'
import PropertiesPage from './pages/PropertiesPage'
import PropertyDetailsPage from './pages/PropertyDetailsPage'
import AboutPage from './pages/AboutPage'
import ContactPage from './pages/ContactPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import SettingsPage from './pages/SettingsPage'
import FavouritesPage from './pages/FavouritesPage'
import AdminDashboard from './pages/AdminDashboard'
import AdminProperties from './pages/AdminProperties'
import AdminMessages from './pages/AdminMessages'
import AdminUserChats from './pages/AdminUserChats'
import AdminUsers from './pages/AdminUsers'
import AdminReviews from './pages/AdminReviews'
import AdminAbout from './pages/AdminAbout'
import AdminProjects from './pages/AdminProjects'
import AdminTeam from './pages/AdminTeam'
import AdminPartners from './pages/AdminPartners'
import AdminShowroom from './pages/AdminShowroom'
import AdminSiteSettings from './pages/AdminSiteSettings'
import AdminLeadRouting from './pages/AdminLeadRouting'
import AdminActivity from './pages/AdminActivity'
import AdminStudioPalette from './pages/AdminStudioPalette'
import AgentDashboard from './pages/AgentDashboard'
import AgentProperties from './pages/AgentProperties'
import AgentMessages from './pages/AgentMessages'
import AgentProfile from './pages/AgentProfile'
import TeamPage from './pages/TeamPage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'

const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage'))
const ConstructionPage = lazy(() => import('./pages/ConstructionPage'))
const RenovationPage = lazy(() => import('./pages/RenovationPage'))
const InteriorDesignPage = lazy(() => import('./pages/InteriorDesignPage'))

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-[#1E1E1C]">
    <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
  </div>
)

const App = ({ ready }) => (
  <BrowserRouter>
    <ThemeProvider>
    <SiteSettingsProvider>
      <ScrollToTop />
      <ToastContainer position="top-right" theme="dark" />
      {ready && <PrivacyBanner />}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<PublicLayout><HomePage /></PublicLayout>} />
          <Route path="/properties" element={<PublicLayout><PropertiesPage /></PublicLayout>} />
          <Route path="/properties/:id" element={<PublicLayout><PropertyDetailsPage /></PublicLayout>} />
          <Route path="/buy" element={<Navigate to="/properties?listingType=Sale" replace />} />
          <Route path="/rent" element={<Navigate to="/properties?listingType=Rent" replace />} />
          <Route path="/team" element={<PublicLayout><TeamPage /></PublicLayout>} />
          <Route path="/about" element={<PublicLayout><AboutPage /></PublicLayout>} />
          <Route path="/contact" element={<PublicLayout><ContactPage /></PublicLayout>} />
          <Route path="/privacy" element={<PublicLayout><PrivacyPolicyPage /></PublicLayout>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/architecture" element={<PublicLayout dark><ArchitecturePage /></PublicLayout>} />
          <Route path="/construction" element={<PublicLayout dark><ConstructionPage /></PublicLayout>} />
          <Route path="/renovation" element={<PublicLayout dark><RenovationPage /></PublicLayout>} />
          <Route path="/interior-design" element={<PublicLayout dark><InteriorDesignPage /></PublicLayout>} />
          <Route path="/favourites" element={<ProtectedRoute><PublicLayout><FavouritesPage /></PublicLayout></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/admin/dashboard" element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/properties" element={<ProtectedRoute requiredRole="admin"><AdminProperties /></ProtectedRoute>} />
          <Route path="/admin/messages" element={<ProtectedRoute requiredRole="admin"><AdminMessages /></ProtectedRoute>} />
          <Route path="/admin/user-chats" element={<ProtectedRoute requiredRole="admin"><AdminUserChats /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requiredRole="owner"><AdminUsers /></ProtectedRoute>} />
          <Route path="/admin/lead-routing" element={<ProtectedRoute requiredRole="owner"><AdminLeadRouting /></ProtectedRoute>} />
          <Route path="/admin/reviews" element={<ProtectedRoute requiredRole="admin"><AdminReviews /></ProtectedRoute>} />
          <Route path="/admin/about" element={<ProtectedRoute requiredRole="admin"><AdminAbout /></ProtectedRoute>} />
          <Route path="/admin/projects" element={<ProtectedRoute requiredRole="admin"><AdminProjects /></ProtectedRoute>} />
          <Route path="/admin/team" element={<ProtectedRoute requiredRole="admin"><AdminTeam /></ProtectedRoute>} />
          <Route path="/admin/partners" element={<ProtectedRoute requiredRole="admin"><AdminPartners /></ProtectedRoute>} />
          <Route path="/admin/showroom" element={<ProtectedRoute requiredRole="admin"><AdminShowroom /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute requiredRole="owner"><AdminSiteSettings /></ProtectedRoute>} />
          <Route path="/admin/activity" element={<ProtectedRoute requiredRole="owner"><AdminActivity /></ProtectedRoute>} />
          <Route path="/admin/studio-palette" element={<ProtectedRoute requiredRole="admin"><AdminStudioPalette /></ProtectedRoute>} />
          {/*
            Agent Portal — strictly role === 'agent'. Admins and owners are
            refused here just as agents are refused /admin/*; the two portals
            never overlap. Kept as flat sibling routes to match the admin
            section above.
          */}
          <Route path="/agent" element={<Navigate to="/agent/dashboard" replace />} />
          <Route path="/agent/dashboard" element={<ProtectedRoute requiredRole="agent"><AgentDashboard /></ProtectedRoute>} />
          <Route path="/agent/properties" element={<ProtectedRoute requiredRole="agent"><AgentProperties /></ProtectedRoute>} />
          {/*
            Human customer↔agent enquiries. Both routes render the same page:
            on desktop the list and the open thread sit side by side, and below
            `lg` the id decides which of the two is shown. Guarded as agent-only
            — these are private participant conversations, so they are NOT
            under /admin/* and admins/owners cannot reach them here or on the
            API.
          */}
          <Route path="/agent/messages" element={<ProtectedRoute requiredRole="agent"><AgentMessages /></ProtectedRoute>} />
          <Route path="/agent/messages/:id" element={<ProtectedRoute requiredRole="agent"><AgentMessages /></ProtectedRoute>} />
          <Route path="/agent/profile" element={<ProtectedRoute requiredRole="agent"><AgentProfile /></ProtectedRoute>} />
          <Route path="*" element={<PublicLayout><HomePage /></PublicLayout>} />
        </Routes>
      </Suspense>
    </SiteSettingsProvider>
    </ThemeProvider>
  </BrowserRouter>
)

export default App
