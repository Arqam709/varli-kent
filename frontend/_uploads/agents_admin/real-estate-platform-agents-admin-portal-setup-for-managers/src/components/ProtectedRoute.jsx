import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAdminAuth } from '../contexts/AdminAuthContext';

// This component protects admin routes by checking if the user is logged in
// If not logged in, it redirects to the admin login page
const ProtectedRoute = ({ children }) => {
  const { isManagerLoggedIn, isLoading } = useAdminAuth();

  // Show loading state while checking auth from localStorage
  if (isLoading) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto'></div>
          <p className='mt-4 text-gray-600'>Loading...</p>
        </div>
      </div>
    );
  }

  // If logged in, render the protected component
  if (isManagerLoggedIn) {
    return children;
  }

  // If not logged in, redirect to login page
  return <Navigate to='/admin/login' replace />;
};

export default ProtectedRoute;
