import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAdminAuth } from '../contexts/AdminAuthContext';

const AdminLogin = () => {
  const navigate = useNavigate();
  const { loginManager } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    
    // Simulate network delay
    setTimeout(() => {
      const result = loginManager(email, password);
      
      if (result.success) {
        toast.success('Login successful! Redirecting to dashboard...');
        setTimeout(() => {
          navigate('/admin/dashboard');
        }, 500);
      } else {
        toast.error(result.message);
      }
      
      setIsLoading(false);
    }, 500);
  };

  // Demo credentials hint
  const fillDemoCredentials = () => {
    setEmail('manager@estate.com');
    setPassword('manager123');
    toast.info('Demo credentials filled');
  };

  return (
    <div className='min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8'>
      <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-8'>
        <div className='text-center mb-8'>
          <h1 className='text-3xl font-bold text-gray-900 mb-2'>Admin Portal</h1>
          <p className='text-gray-600'>Manager Login</p>
        </div>

        <form onSubmit={handleSubmit} className='space-y-6'>
          <div>
            <label htmlFor='email' className='block text-sm font-medium text-gray-700'>
              Email Address
            </label>
            <input
              type='email'
              id='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='manager@estate.com'
              className='mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500'
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor='password' className='block text-sm font-medium text-gray-700'>
              Password
            </label>
            <input
              type='password'
              id='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='••••••••'
              className='mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500'
              disabled={isLoading}
            />
          </div>

          <button
            type='submit'
            disabled={isLoading}
            className='w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className='mt-6 border-t pt-6'>
          <p className='text-xs text-gray-600 text-center mb-3'>
            🧪 <strong>Development Mode:</strong> Click below for demo credentials
          </p>
          <button
            onClick={fillDemoCredentials}
            className='w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded-md transition duration-200 text-sm'
          >
            Fill Demo Credentials
          </button>
        </div>

        <div className='mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded-md'>
          <p className='text-xs text-yellow-800'>
            <strong>⚠️ Security Notice:</strong> This is a temporary frontend-only authentication system for development purposes only. In production, authentication must be handled on the backend with secure password hashing (bcrypt), JWT tokens, HTTPS, and protected API routes.
          </p>
        </div>

        <div className='mt-4 text-center'>
          <a href='/' className='text-sm text-blue-600 hover:text-blue-800'>
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
