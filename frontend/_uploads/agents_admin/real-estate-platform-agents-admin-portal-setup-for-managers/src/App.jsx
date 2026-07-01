import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { AdminAuthProvider } from './contexts/AdminAuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import PublicLayout from './components/PublicLayout'
import HomePage from './pages/HomePage'
import PropertiesPage from './pages/PropertiesPage'
import PropertyDetailsPage from './pages/PropertyDetailsPage'
import CommunitiesPage from './pages/CommunitiesPage'
import BuyingPage from './pages/BuyingPage'
import SellingPage from './pages/SellingPage'
import AboutPage from './pages/AboutPage'
import ContactPage from './pages/ContactPage'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminProperties from './pages/AdminProperties'
import AdminMessages from './pages/AdminMessages'

const App = () => {
  return (
    <AdminAuthProvider>
      <BrowserRouter>
        <ToastContainer position='top-right' theme='dark' />
        <Routes>
          <Route
            path='/'
            element={
              <PublicLayout>
                <HomePage />
              </PublicLayout>
            }
          />
          <Route
            path='/properties'
            element={
              <PublicLayout>
                <PropertiesPage />
              </PublicLayout>
            }
          />
          <Route
            path='/properties/:id'
            element={
              <PublicLayout>
                <PropertyDetailsPage />
              </PublicLayout>
            }
          />
          <Route
            path='/communities'
            element={
              <PublicLayout>
                <CommunitiesPage />
              </PublicLayout>
            }
          />
          <Route
            path='/buying'
            element={
              <PublicLayout>
                <BuyingPage />
              </PublicLayout>
            }
          />
          <Route
            path='/selling'
            element={
              <PublicLayout>
                <SellingPage />
              </PublicLayout>
            }
          />
          <Route
            path='/about'
            element={
              <PublicLayout>
                <AboutPage />
              </PublicLayout>
            }
          />
          <Route
            path='/contact'
            element={
              <PublicLayout>
                <ContactPage />
              </PublicLayout>
            }
          />

          <Route path='/admin/login' element={<AdminLogin />} />
          <Route
            path='/admin/dashboard'
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path='/admin/properties'
            element={
              <ProtectedRoute>
                <AdminProperties />
              </ProtectedRoute>
            }
          />
          <Route
            path='/admin/messages'
            element={
              <ProtectedRoute>
                <AdminMessages />
              </ProtectedRoute>
            }
          />

          <Route
            path='*'
            element={
              <PublicLayout>
                <HomePage />
              </PublicLayout>
            }
          />
        </Routes>
      </BrowserRouter>
    </AdminAuthProvider>
  )
}

export default App
