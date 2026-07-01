import logo from './logo.svg'
import logo_dark from './logo_dark.svg'
import cross_icon from './cross_icon.svg'
import menu_icon from './menu_icon.svg'
import star_icon from './star_icon.svg'
import left_arrow from './left_arrow.svg'
import right_arrow from './right_arrow.svg'
import header_img from './header_img.png'
import brand_img from './brand_img.png'
import project_img_1 from './project_img_1.jpg'
import project_img_2 from './project_img_2.jpg'
import project_img_3 from './project_img_3.jpg'
import project_img_4 from './project_img_4.jpg'
import project_img_5 from './project_img_5.jpg'
import project_img_6 from './project_img_6.jpg'
import profile_img_1 from './profile_img_1.png'
import profile_img_2 from './profile_img_2.png'
import profile_img_3 from './profile_img_3.png'

export const assets = {
  logo,
  logo_dark,
  cross_icon,
  menu_icon,
  star_icon,
  left_arrow,
  right_arrow,
  header_img,
  brand_img,
  project_img_1,
  project_img_2,
  project_img_3,
  project_img_4,
  project_img_5,
  project_img_6,
  profile_img_1,
  profile_img_2,
  profile_img_3,
};

export const propertiesData = [
  {
    id: 1,
    status: 'Featured',
    price: '$1,850,000',
    title: 'Istanbul Sky Residences',
    address: 'Levent, Istanbul',
    location: 'Istanbul',
    beds: 4,
    baths: 3,
    area: '3,200 sqft',
    image: project_img_1,
    gallery: [project_img_1, project_img_2, project_img_3],
    type: 'Sale',
    description:
      'Elegant city residence with panoramic views of the Bosphorus, designer finishes, and a private terrace for luxury living.',
    amenities: ['Private rooftop terrace', 'Smart home system', '24/7 concierge', 'Indoor pool', 'Gym access'],
    agent: {
      name: 'Selin Kaya',
      phone: '+90 530 123 4567',
      email: 'selin@luxre.co',
    },
  },
  {
    id: 2,
    status: 'For Sale',
    price: '$980,000',
    title: 'Beylikdüzü Garden Villas',
    address: 'Beylikdüzü, Istanbul',
    location: 'Beylikdüzü',
    beds: 3,
    baths: 2,
    area: '2,400 sqft',
    image: project_img_2,
    gallery: [project_img_2, project_img_4, project_img_5],
    type: 'Sale',
    description:
      'Contemporary villas nestled among leafy streets, offering spacious living areas, private gardens, and premium finishes.',
    amenities: ['Private parking', 'Outdoor lounge', 'Premium kitchen', 'Secure gated community'],
    agent: {
      name: 'Mert Denker',
      phone: '+90 540 321 7654',
      email: 'mert@luxre.co',
    },
  },
  {
    id: 3,
    status: 'For Rent',
    price: '$3,950 / month',
    title: 'Şişli City Penthouse',
    address: 'Şişli, Istanbul',
    location: 'Şişli',
    beds: 2,
    baths: 2,
    area: '1,600 sqft',
    image: project_img_3,
    gallery: [project_img_3, project_img_1, project_img_6],
    type: 'Rent',
    description:
      'Luxury penthouse with high ceilings, floor-to-ceiling windows, and designer interiors in the heart of the city.',
    amenities: ['Concierge service', 'Private elevator', 'Rooftop terrace', 'Fitness center'],
    agent: {
      name: 'Lina Öztürk',
      phone: '+90 532 678 9123',
      email: 'lina@luxre.co',
    },
  },
  {
    id: 4,
    status: 'Featured',
    price: '$1,150,000',
    title: 'Kadıköy Harbor Lofts',
    address: 'Kadıköy, Istanbul',
    location: 'Kadıköy',
    beds: 3,
    baths: 3,
    area: '2,700 sqft',
    image: project_img_4,
    gallery: [project_img_4, project_img_5, project_img_2],
    type: 'Sale',
    description:
      'Modern waterfront lofts with exquisite finishes, an open floor plan, and seamless indoor-outdoor living.',
    amenities: ['Harbor views', 'Gym access', 'Infinity pool', 'Smart security'],
    agent: {
      name: 'Arda Aydın',
      phone: '+90 541 234 9876',
      email: 'arda@luxre.co',
    },
  },
  {
    id: 5,
    status: 'For Rent',
    price: '$2,400 / month',
    title: 'Beşiktaş River Suites',
    address: 'Beşiktaş, Istanbul',
    location: 'Beşiktaş',
    beds: 2,
    baths: 2,
    area: '1,750 sqft',
    image: project_img_5,
    gallery: [project_img_5, project_img_6, project_img_1],
    type: 'Rent',
    description:
      'Premium riverside suites with designer finishes, concierge service, and direct access to Istanbul’s finest dining and culture.',
    amenities: ['River walk access', 'Housekeeping service', 'Private balcony', 'Valet parking'],
    agent: {
      name: 'Elif Yılmaz',
      phone: '+90 533 987 6541',
      email: 'elif@luxre.co',
    },
  },
  {
    id: 6,
    status: 'For Sale',
    price: '$1,300,000',
    title: 'Başakşehir Park Residences',
    address: 'Başakşehir, Istanbul',
    location: 'Başakşehir',
    beds: 4,
    baths: 3,
    area: '2,900 sqft',
    image: project_img_6,
    gallery: [project_img_6, project_img_3, project_img_4],
    type: 'Sale',
    description:
      'Spacious residences in a modern development offering bright interiors, green courtyards, and high-end finishes.',
    amenities: ['Community lounge', 'Children’s play area', 'Swimming complex', '24/7 security'],
    agent: {
      name: 'Deniz Karaca',
      phone: '+90 538 112 3344',
      email: 'deniz@luxre.co',
    },
  },
];

export const communityData = [
  {
    id: 'istanbul',
    name: 'Istanbul',
    image: project_img_1,
    description: 'The city where historic elegance meets modern luxury, ideal for international buyers and investors.',
  },
  {
    id: 'beylikduzu',
    name: 'Beylikdüzü',
    image: project_img_2,
    description: 'A serene community with waterfront parks, premium developments, and easy access to the city.',
  },
  {
    id: 'basaksehir',
    name: 'Başakşehir',
    image: project_img_3,
    description: 'A modern neighborhood with family-friendly amenities, green spaces, and spacious residences.',
  },
  {
    id: 'sisli',
    name: 'Şişli',
    image: project_img_4,
    description: 'A sophisticated district with luxury shopping, vibrant culture, and prime residential towers.',
  },
  {
    id: 'kadikoy',
    name: 'Kadıköy',
    image: project_img_5,
    description: 'Charming waterfront living with boutique eateries, creative energy, and elegant residences.',
  },
  {
    id: 'besiktas',
    name: 'Beşiktaş',
    image: project_img_6,
    description: 'A dynamic borough with riverfront views, luxury homes, and iconic city access.',
  },
];

export const buyingBenefits = [
  {
    icon: '🔎',
    title: 'Property Search',
    description: 'We locate the finest luxury homes that meet your lifestyle needs and investment goals.',
  },
  {
    icon: '📅',
    title: 'Viewing Appointments',
    description: 'Schedule private tours at convenient times with expert guidance at every step.',
  },
  {
    icon: '🤝',
    title: 'Negotiation Support',
    description: 'Our team secures the best terms on your behalf with deep market expertise.',
  },
  {
    icon: '📄',
    title: 'Paperwork Guidance',
    description: 'We simplify contracts, inspections, and closing documents for a seamless process.',
  },
];

export const sellingBenefits = [
  {
    icon: '🏷️',
    title: 'Property Valuation',
    description: 'Accurate pricing to attract premium buyers while maximizing your return.',
  },
  {
    icon: '📣',
    title: 'Marketing',
    description: 'Luxury listings promoted across high-end channels to reach qualified buyers.',
  },
  {
    icon: '📸',
    title: 'Professional Photos',
    description: 'Stunning imagery and virtual staging that showcase your property at its best.',
  },
  {
    icon: '📈',
    title: 'Buyer Leads',
    description: 'We provide a steady pipeline of motivated buyers for faster sales.',
  },
  {
    icon: '✅',
    title: 'Closing Support',
    description: 'Full support through inspections, negotiations, and final paperwork.',
  },
];

export const testimonialsData = [
  {
    name: 'Elif Acar',
    title: 'Investment Executive',
    image: profile_img_1,
    alt: 'Portrait of Elif Acar',
    rating: 5,
    text: 'The team delivered exceptional service from search to closing. The property selection and support were outstanding.',
  },
  {
    name: 'Can Yıldırım',
    title: 'Executive Consultant',
    image: profile_img_2,
    alt: 'Portrait of Can Yıldırım',
    rating: 5,
    text: 'Working with them made buying our home effortless. Professional guidance and excellent communication throughout.',
  },
  {
    name: 'Aylin Şener',
    title: 'Architect',
    image: profile_img_3,
    alt: 'Portrait of Aylin Şener',
    rating: 5,
    text: 'A refined, thoughtful approach to property marketing. They helped us close quickly at the right price.',
  },
];

export const defaultMessages = [
  {
    id: 1,
    name: 'Mert Yılmaz',
    email: 'mert.y@example.com',
    phone: '+90 530 654 3210',
    interest: 'Buying',
    message: 'I am looking for a luxury apartment near the Bosphorus with a sea view.',
    status: 'New',
  },
  {
    id: 2,
    name: 'Selin Öztürk',
    email: 'selin.oz@example.com',
    phone: '+90 532 987 1234',
    interest: 'Selling',
    message: 'I need help valuing my property in Şişli and preparing it for the market.',
    status: 'Replied',
  },
  {
    id: 3,
    name: 'Lina Arslan',
    email: 'lina.a@example.com',
    phone: '+90 534 555 6677',
    interest: 'Renting',
    message: 'Looking for a modern rental apartment close to public transport in Kadıköy.',
    status: 'New',
  },
];
