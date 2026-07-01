import axios from 'axios'

export const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const api = axios.create({
  baseURL: apiUrl,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('varlikent_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api
