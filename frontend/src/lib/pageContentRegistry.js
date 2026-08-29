
export const PAGE_CONTENT_REGISTRY = {
  home: {
    label: 'Homepage',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'Istanbul — Architecture · Construction · Real Estate' },
        { key: 'heroHeading1', label: 'Heading — line 1', type: 'text', default: 'We Design, Build' },
        { key: 'heroHeading2', label: 'Heading — line 2', type: 'text', default: '& Deliver Exceptional' },
        { key: 'heroHeading3', label: 'Heading — line 3', type: 'text', default: 'Spaces in Istanbul' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: 'Architecture · Construction · Renovation · Interior Design · Real Estate — all under one roof.' },
        { key: 'heroCtaPrimary', label: 'Primary button text', type: 'text', default: 'Explore Our Services' },
        { key: 'heroCtaSecondary', label: 'Secondary button text', type: 'text', default: 'View Properties' },
        { key: 'heroImage', label: 'Background image', type: 'image', default: '/images/hero-villa.jpg.png' },
      ],
    },
    sections: [
      {
        key: 'featured', defaultTitle: 'Featured Properties',
        fields: [
          { key: 'featuredLabel', label: 'Label', type: 'text', default: 'Handpicked' },
          { key: 'featuredHeading', label: 'Heading', type: 'text', default: 'Featured Properties' },
          { key: 'featuredSubtitle', label: 'Subtitle', type: 'text', default: 'Exclusive homes curated for discerning buyers and renters across Istanbul.' },
          { key: 'featuredViewAll', label: 'Button text', type: 'text', default: 'View All Properties' },
          { key: 'featuredEmpty', label: 'Empty-state text', type: 'text', default: 'No featured properties yet.' },
        ],
      },
      {
        key: 'services', defaultTitle: 'Five Services. One Company.',
        fields: [
          { key: 'servicesLabel', label: 'Label', type: 'text', default: 'What We Do' },
          { key: 'servicesHeading', label: 'Heading', type: 'text', default: 'Five Services. One Company.' },
          { key: 'servicesSubheading', label: 'Subheading', type: 'text', default: 'From the first sketch to the final sale — we cover every stage of the property lifecycle.' },
        ],
      },
      {
        key: 'about', defaultTitle: "Istanbul's Complete Property Company",
        fields: [
          { key: 'aboutLabel', label: 'Label', type: 'text', default: 'Who We Are' },
          { key: 'aboutHeading', label: 'Heading', type: 'text', default: "Istanbul's Complete Property Company" },
          { key: 'aboutBody1', label: 'Paragraph 1', type: 'text', default: "VarliKent is Istanbul's full-service property company. We don't just find properties — we design them, build them, renovate them, and bring them to life with exceptional interior work." },
          { key: 'aboutBody2', label: 'Paragraph 2', type: 'text', default: 'Founded with a vision to unify the property lifecycle under one trusted name, we serve homeowners, developers, and investors seeking excellence at every stage.' },
          { key: 'aboutCta', label: 'Button text', type: 'text', default: 'Our Story' },
        ],
      },
      {
        key: 'browse', defaultTitle: 'For Sale or Rent',
        fields: [
          { key: 'browseLabel', label: 'Label', type: 'text', default: 'Browse By Type' },
          { key: 'browseHeading', label: 'Heading', type: 'text', default: 'For Sale or Rent' },
          { key: 'browseListings', label: '"Listings available" text', type: 'text', default: 'listings available' },
          { key: 'browseSaleTitle', label: 'Sale card — title', type: 'text', default: 'Properties for Sale' },
          { key: 'browseSaleDesc', label: 'Sale card — description', type: 'text', default: 'Invest in Istanbul — from city apartments to Bosphorus villas.' },
          { key: 'browseSaleBtn', label: 'Sale card — button text', type: 'text', default: 'Explore Sales' },
          { key: 'browseRentTitle', label: 'Rent card — title', type: 'text', default: 'Properties for Rent' },
          { key: 'browseRentDesc', label: 'Rent card — description', type: 'text', default: "Flexible rental options across Istanbul's most sought-after neighbourhoods." },
          { key: 'browseRentBtn', label: 'Rent card — button text', type: 'text', default: 'Explore Rentals' },
        ],
      },
      {
        key: 'trust', defaultTitle: 'Why VarliKent',
        fields: [
          { key: 'trustLabel', label: 'Label', type: 'text', default: 'Why VarliKent' },
          { key: 'trustHeading', label: 'Heading', type: 'text', default: 'A refined approach to property — from design to delivery.' },
          { key: 'trustBody', label: 'Body', type: 'text', default: 'We bring together market intelligence, architectural expertise, and exceptional service — guiding clients through every stage of the property journey with precision and care.' },
          { key: 'trustImage', label: 'Image', type: 'image', default: '/images/why-villa.png' },
        ],
      },
      {
        key: 'process', defaultTitle: 'From Vision to Handover',
        fields: [
          { key: 'processLabel', label: 'Label', type: 'text', default: 'How We Work' },
          { key: 'processHeading', label: 'Heading', type: 'text', default: 'From Vision to Handover' },
          { key: 'processSubheading', label: 'Subheading', type: 'text', default: 'A clear, proven process that takes your project from concept to completion.' },
        ],
      },
      {
        key: 'projects', defaultTitle: 'Selected Projects',
        fields: [
          { key: 'projectsLabel', label: 'Label', type: 'text', default: 'Our Work' },
          { key: 'projectsHeading', label: 'Heading', type: 'text', default: 'Selected Projects' },
          { key: 'projectsSubtitle', label: 'Subtitle', type: 'text', default: 'A glimpse into the spaces we have designed, built and transformed across Istanbul.' },
          { key: 'projectsViewAll', label: 'Button text', type: 'text', default: 'See All Projects' },
        ],
      },
      {
        key: 'stats', defaultTitle: 'Statistics',
        fields: [
          { key: 'statsValue1', label: 'Stat 1 — number', type: 'text', default: '500+' },
          { key: 'statsLabel1', label: 'Stat 1 — label', type: 'text', default: 'Properties Listed' },
          { key: 'statsValue2', label: 'Stat 2 — number', type: 'text', default: '10+' },
          { key: 'statsLabel2', label: 'Stat 2 — label', type: 'text', default: 'Years Experience' },
          { key: 'statsValue3', label: 'Stat 3 — number', type: 'text', default: '120+' },
          { key: 'statsLabel3', label: 'Stat 3 — label', type: 'text', default: 'Happy Clients' },
          { key: 'statsValue4', label: 'Stat 4 — number', type: 'text', default: '40+' },
          { key: 'statsLabel4', label: 'Stat 4 — label', type: 'text', default: 'Districts Covered' },
        ],
      },
      {
        key: 'testimonials', defaultTitle: 'Client Testimonials',
        fields: [
          { key: 'testimonialsLabel', label: 'Label', type: 'text', default: 'Client Stories' },
          { key: 'testimonialsHeading', label: 'Heading', type: 'text', default: 'What Our Clients Say' },
          { key: 'testimonialsDisclaimer', label: 'Disclaimer text', type: 'text', default: 'Website testimonials from verified clients' },
        ],
      },
      {
        key: 'partners', defaultTitle: 'Partner Companies',
        fields: [
          { key: 'partnersLabel', label: 'Label', type: 'text', default: 'Trusted By Leading Companies' },
        ],
      },
      {
        key: 'cta', defaultTitle: 'Call to Action',
        fields: [
          { key: 'ctaHeading', label: 'Heading', type: 'text', default: 'Ready to Start Your Project?' },
          { key: 'ctaBody', label: 'Body', type: 'text', default: 'Whether you are buying, building, renovating or designing — our team guides you from the first conversation to final delivery.' },
          { key: 'ctaBrowse', label: 'Primary button text', type: 'text', default: 'Explore Services' },
          { key: 'ctaContact', label: 'Secondary button text', type: 'text', default: 'Contact Us' },
        ],
      },
    ],
  },

  architecture: {
    label: 'Architecture',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'Varlikent / Architecture' },
        { key: 'heroHeading', label: 'Heading', type: 'text', default: 'Architecture' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: "We design buildings that endure — rooted in Istanbul's heritage, shaped for the future." },
        { key: 'heroCtaPrimary', label: 'Primary button text', type: 'text', default: 'Start a Project' },
        { key: 'heroCtaSecondary', label: 'Secondary button text', type: 'text', default: 'View Portfolio' },
      ],
    },
    sections: [
      {
        key: 'model', defaultTitle: 'Architectural Model Showcase',
        fields: [
          { key: 'modelLabel', label: 'Label', type: 'text', default: 'Concept to Form' },
          { key: 'modelHeading', label: 'Heading', type: 'text', default: 'Architectural Model Showcase' },
          { key: 'modelDesc', label: 'Description', type: 'text', default: 'Explore a full-scale design concept, rendered in true detail — rotate, zoom, and study every elevation.' },
          { key: 'modelBtn', label: 'Button text', type: 'text', default: 'View Architectural Model' },
        ],
      },
      {
        key: 'showroom', defaultTitle: 'Architecture Showcase',
        fields: [
          { key: 'showroomLabel', label: 'Label', type: 'text', default: 'Our Work' },
          { key: 'showroomHeading', label: 'Heading', type: 'text', default: 'Architecture Showcase' },
        ],
      },
      {
        key: 'services', defaultTitle: 'Services',
        fields: [
          { key: 'servicesLabel', label: 'Label', type: 'text', default: 'What We Offer' },
          { key: 'servicesHeading', label: 'Heading', type: 'text', default: 'Services' },
          { key: 'service1Title', label: 'Service 1 — title', type: 'text', default: 'Concept & Design' },
          { key: 'service1Desc', label: 'Service 1 — description', type: 'text', default: 'From initial brief to detailed architectural plans — space that inspires.' },
          { key: 'service2Title', label: 'Service 2 — title', type: 'text', default: 'Structural Engineering' },
          { key: 'service2Desc', label: 'Service 2 — description', type: 'text', default: 'Robust, code-compliant systems for every building typology.' },
          { key: 'service3Title', label: 'Service 3 — title', type: 'text', default: 'Urban Planning' },
          { key: 'service3Desc', label: 'Service 3 — description', type: 'text', default: "Master plans aligned with Istanbul's evolving urban fabric." },
          { key: 'service4Title', label: 'Service 4 — title', type: 'text', default: 'Project Management' },
          { key: 'service4Desc', label: 'Service 4 — description', type: 'text', default: 'Full oversight from groundbreaking to handover.' },
        ],
      },
      {
        key: 'process', defaultTitle: 'Process',
        fields: [
          { key: 'processLabel', label: 'Label', type: 'text', default: 'How We Work' },
          { key: 'processHeading', label: 'Heading', type: 'text', default: 'Process' },
          { key: 'processStep1', label: 'Step 1', type: 'text', default: 'Brief & Research' },
          { key: 'processStep2', label: 'Step 2', type: 'text', default: 'Concept Design' },
          { key: 'processStep3', label: 'Step 3', type: 'text', default: 'Technical Development' },
          { key: 'processStep4', label: 'Step 4', type: 'text', default: 'Construction Oversight' },
        ],
      },
      {
        key: 'cta', defaultTitle: 'Call to Action',
        fields: [
          { key: 'ctaHeading', label: 'Heading', type: 'text', default: 'Have a vision?' },
          { key: 'ctaBody', label: 'Body', type: 'text', default: 'Contact us to discuss your project.' },
          { key: 'ctaBtn', label: 'Button text', type: 'text', default: 'Get in Touch' },
        ],
      },
    ],
  },

  construction: {
    label: 'Construction',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'Varlikent / Construction' },
        { key: 'heroHeading', label: 'Heading', type: 'text', default: 'Construction' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: "High-performance construction for Istanbul's most ambitious developments." },
        { key: 'heroCtaPrimary', label: 'Primary button text', type: 'text', default: 'Request a Quote' },
        { key: 'heroCtaSecondary', label: 'Secondary button text', type: 'text', default: 'Live Progress' },
      ],
    },
    sections: [
      {
        key: 'viewer', defaultTitle: 'Construction Progression',
        fields: [
          { key: 'viewerLabel', label: 'Label', type: 'text', default: 'Watch It Rise' },
          { key: 'viewerHeading', label: 'Heading', type: 'text', default: 'Construction Progression' },
          { key: 'viewerDesc', label: 'Description', type: 'text', default: 'Step through every stage of a villa build — from foundation to final envelope.' },
          { key: 'progressLabel', label: 'Progress section label', type: 'text', default: 'Current Project' },
          { key: 'completionLabel', label: '"Estimated completion" text', type: 'text', default: 'Estimated completion:' },
        ],
      },
      {
        key: 'showroom', defaultTitle: 'Construction Showcase',
        fields: [
          { key: 'showroomLabel', label: 'Label', type: 'text', default: 'Our Work' },
          { key: 'showroomHeading', label: 'Heading', type: 'text', default: 'Construction Showcase' },
        ],
      },
      {
        key: 'services', defaultTitle: 'Construction Services',
        fields: [
          { key: 'servicesLabel', label: 'Label', type: 'text', default: 'What We Build' },
          { key: 'servicesHeading', label: 'Heading', type: 'text', default: 'Construction Services' },
        ],
      },
      {
        key: 'process', defaultTitle: 'Our Process',
        fields: [
          { key: 'processLabel', label: 'Label', type: 'text', default: 'How We Work' },
          { key: 'processHeading', label: 'Heading', type: 'text', default: 'Our Process' },
        ],
      },
      {
        key: 'seismic', defaultTitle: 'Earthquake-Resistant Engineering',
        fields: [
          { key: 'seismicLabel', label: 'Label', type: 'text', default: 'Built to Withstand' },
          { key: 'seismicHeading', label: 'Heading', type: 'text', default: 'Earthquake-Resistant Engineering' },
          { key: 'seismicBody', label: 'Body', type: 'text', default: 'Istanbul sits in an active seismic zone. Every structure we deliver is engineered to current Turkish seismic design codes, with safety margins verified at each stage of construction — not assumed.' },
        ],
      },
      {
        key: 'cta', defaultTitle: 'Call to Action',
        fields: [
          { key: 'ctaHeading', label: 'Heading', type: 'text', default: 'Ready to Break Ground?' },
          { key: 'ctaBody', label: 'Body', type: 'text', default: 'Partner with our construction team for your next Istanbul development.' },
          { key: 'ctaBtn', label: 'Button text', type: 'text', default: 'Contact Us' },
        ],
      },
    ],
  },

  renovation: {
    label: 'Renovation',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'Varlikent / Renovation' },
        { key: 'heroHeading', label: 'Heading', type: 'text', default: 'Renovation' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: 'Transform any space with premium finishes, intelligent layout, and expert craftsmanship.' },
        { key: 'heroCtaPrimary', label: 'Primary button text', type: 'text', default: 'Plan Your Renovation' },
        { key: 'heroCtaSecondary', label: 'Secondary button text', type: 'text', default: 'Open Renovation Studio' },
      ],
    },
    sections: [
      {
        key: 'transform', defaultTitle: 'Before & After',
        fields: [
          { key: 'transformLabel', label: 'Label', type: 'text', default: 'The Transformation' },
          { key: 'transformHeading', label: 'Heading', type: 'text', default: 'Before & After' },
          { key: 'beforeTitle', label: '"Before" column title', type: 'text', default: 'Before' },
          { key: 'afterTitle', label: '"After" column title', type: 'text', default: 'After' },
          { key: 'beforeItem1', label: 'Before — item 1', type: 'text', default: 'Dated finishes' },
          { key: 'beforeItem2', label: 'Before — item 2', type: 'text', default: 'Poor natural lighting' },
          { key: 'beforeItem3', label: 'Before — item 3', type: 'text', default: 'Inefficient layout' },
          { key: 'beforeItem4', label: 'Before — item 4', type: 'text', default: 'Original 1990s fixtures' },
          { key: 'afterItem1', label: 'After — item 1', type: 'text', default: 'Premium marble surfaces' },
          { key: 'afterItem2', label: 'After — item 2', type: 'text', default: 'Architectural lighting design' },
          { key: 'afterItem3', label: 'After — item 3', type: 'text', default: 'Open-plan remodel' },
          { key: 'afterItem4', label: 'After — item 4', type: 'text', default: 'Smart home integration' },
        ],
      },
      {
        key: 'studio', defaultTitle: 'Renovation Studio',
        fields: [
          { key: 'studioLabel', label: 'Label', type: 'text', default: 'Interactive' },
          { key: 'studioHeading', label: 'Heading', type: 'text', default: 'Renovation Studio' },
          { key: 'studioDesc', label: 'Description', type: 'text', default: 'Preview the transformation. Drag the slider, choose finishes, and set the lighting mood.' },
        ],
      },
      {
        key: 'palette', defaultTitle: 'Signature Material Palette',
        fields: [
          { key: 'paletteLabel', label: 'Label', type: 'text', default: 'Materials' },
          { key: 'paletteHeading', label: 'Heading', type: 'text', default: 'Signature Material Palette' },
        ],
      },
      {
        key: 'showroom', defaultTitle: 'Renovation Showcase',
        fields: [
          { key: 'showroomLabel', label: 'Label', type: 'text', default: 'Our Work' },
          { key: 'showroomHeading', label: 'Heading', type: 'text', default: 'Renovation Showcase' },
        ],
      },
      {
        key: 'services', defaultTitle: 'Renovation Services',
        fields: [
          { key: 'servicesLabel', label: 'Label', type: 'text', default: 'What We Do' },
          { key: 'servicesHeading', label: 'Heading', type: 'text', default: 'Renovation Services' },
          { key: 'service1Title', label: 'Service 1 — title', type: 'text', default: 'Window & Door Replacement' },
          { key: 'service1Desc', label: 'Service 1 — description', type: 'text', default: 'Thermally broken aluminium and timber joinery with acoustic glazing.' },
          { key: 'service2Title', label: 'Service 2 — title', type: 'text', default: 'Structural Alterations' },
          { key: 'service2Desc', label: 'Service 2 — description', type: 'text', default: 'Safe load-bearing modifications, wall removals and ceiling raising.' },
          { key: 'service3Title', label: 'Service 3 — title', type: 'text', default: 'Electrical & Lighting' },
          { key: 'service3Desc', label: 'Service 3 — description', type: 'text', default: 'Full rewire, smart home integration and bespoke lighting design.' },
          { key: 'service4Title', label: 'Service 4 — title', type: 'text', default: 'Bathroom & Kitchen' },
          { key: 'service4Desc', label: 'Service 4 — description', type: 'text', default: 'Marble wet rooms, bespoke cabinetry and premium appliance fit-out.' },
        ],
      },
      {
        key: 'cta', defaultTitle: 'Call to Action',
        fields: [
          { key: 'ctaHeading', label: 'Heading', type: 'text', default: 'Transform Your Space' },
          { key: 'ctaBody', label: 'Body', type: 'text', default: "Let's discuss your renovation project and bring your vision to life." },
          { key: 'ctaBtn', label: 'Button text', type: 'text', default: 'Get Started' },
        ],
      },
    ],
  },

  'interior-design': {
    label: 'Interior Design',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'Varlikent / Interior Design' },
        { key: 'heroHeading', label: 'Heading', type: 'text', default: 'Interior Design' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: 'Spaces that breathe sophistication — from the first concept to the final detail.' },
        { key: 'heroCtaPrimary', label: 'Primary button text', type: 'text', default: 'Book a Consultation' },
        { key: 'heroCtaSecondary', label: 'Secondary button text', type: 'text', default: 'Design a Room' },
      ],
    },
    sections: [
      {
        key: 'model', defaultTitle: 'Interior Showcase (3D model)',
        fields: [
          { key: 'modelLabel', label: 'Label', type: 'text', default: 'Signature Living Room' },
          { key: 'modelHeading', label: 'Heading', type: 'text', default: 'Interior Showcase' },
          { key: 'modelDesc', label: 'Description', type: 'text', default: 'A fully realised interior, rendered in true detail — rotate, zoom, and study every finish.' },
          { key: 'modelBtn', label: 'Button text', type: 'text', default: 'View Interior Model' },
        ],
      },
      {
        key: 'styles', defaultTitle: 'Design Styles',
        fields: [
          { key: 'stylesLabel', label: 'Label', type: 'text', default: 'Aesthetic Direction' },
          { key: 'stylesHeading', label: 'Heading', type: 'text', default: 'Design Styles' },
          { key: 'stylesFilterHint', label: 'Filter hint text', type: 'text', default: 'Select a style to filter the showcase' },
        ],
      },
      {
        key: 'showroom', defaultTitle: 'Interior Showcase',
        fields: [
          { key: 'showroomLabel', label: 'Label', type: 'text', default: 'Our Work' },
          { key: 'showroomHeading', label: 'Heading', type: 'text', default: 'Interior Showcase' },
        ],
      },
      {
        key: 'finishes', defaultTitle: 'Wall & Floor Finishes',
        fields: [
          { key: 'finishesLabel', label: 'Label', type: 'text', default: 'Finishes' },
          { key: 'finishesHeading', label: 'Heading', type: 'text', default: 'Wall & Floor Finishes' },
          { key: 'previewLabel', label: 'Preview caption', type: 'text', default: 'Wall & floor colour preview' },
        ],
      },
      {
        key: 'palette', defaultTitle: 'Signature Materials',
        fields: [
          { key: 'paletteHeading', label: 'Heading', type: 'text', default: 'Signature Materials' },
        ],
      },
      {
        key: 'services', defaultTitle: 'Interior Design Services',
        fields: [
          { key: 'servicesLabel', label: 'Label', type: 'text', default: 'Our Expertise' },
          { key: 'servicesHeading', label: 'Heading', type: 'text', default: 'Interior Design Services' },
          { key: 'service1Title', label: 'Service 1 — title', type: 'text', default: 'Concept & Mood Boards' },
          { key: 'service1Desc', label: 'Service 1 — description', type: 'text', default: 'Visual direction for every room — colour stories, material palettes and spatial flow.' },
          { key: 'service2Title', label: 'Service 2 — title', type: 'text', default: 'Furniture Sourcing' },
          { key: 'service2Desc', label: 'Service 2 — description', type: 'text', default: 'Curated selection from Italian and Scandinavian premium suppliers, delivered and installed.' },
          { key: 'service3Title', label: 'Service 3 — title', type: 'text', default: 'Art & Accessories' },
          { key: 'service3Desc', label: 'Service 3 — description', type: 'text', default: 'Original artwork, sculptures and decorative objects that elevate every corner.' },
          { key: 'service4Title', label: 'Service 4 — title', type: 'text', default: 'Lighting Design' },
          { key: 'service4Desc', label: 'Service 4 — description', type: 'text', default: 'Layered ambient, task and accent lighting to create mood and highlight architecture.' },
        ],
      },
      {
        key: 'cta', defaultTitle: 'Call to Action',
        fields: [
          { key: 'ctaHeading', label: 'Heading', type: 'text', default: 'Design Your Dream Space' },
          { key: 'ctaBody', label: 'Body', type: 'text', default: 'Book a complimentary 30-minute consultation with our design team.' },
          { key: 'ctaBtn', label: 'Button text', type: 'text', default: 'Book Now' },
        ],
      },
    ],
  },

  team: {
    label: 'Team',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'The People Behind VarliKent' },
        { key: 'heroHeading', label: 'Heading', type: 'text', default: 'Our Team' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: 'Architects, designers, engineers and advisors united by a passion for exceptional spaces.' },
        { key: 'emptyText', label: 'Empty-state text', type: 'text', default: 'Team members coming soon.' },
      ],
    },
    // The team members themselves are records owned by /admin/team.
    sections: [],
  },

  contact: {
    label: 'Contact',
    hero: {
      fields: [
        { key: 'heroLabel', label: 'Label', type: 'text', default: 'Get in Touch' },
        { key: 'heroHeading', label: 'Heading', type: 'text', default: 'Contact VarliKent' },
        { key: 'heroSubtitle', label: 'Subtitle', type: 'text', default: 'Our team of luxury real estate experts is ready to assist you — whether you are buying, selling, or investing in Istanbul.' },
        { key: 'officeLocationLabel', label: 'Office location label', type: 'text', default: 'Office Location' },
        { key: 'formHeading', label: 'Form heading', type: 'text', default: 'Send a Message' },
        { key: 'interestLabel', label: '"I am interested in" label', type: 'text', default: 'I am interested in' },
        { key: 'sendBtn', label: 'Send button text', type: 'text', default: 'Send Message' },
        { key: 'successHeading', label: 'Success heading', type: 'text', default: 'Message Sent!' },
        { key: 'successBody', label: 'Success body', type: 'text', default: 'Our team will get back to you within 24 hours.' },
      ],
    },
    sections: [],
  },
}

export const PAGE_CONTENT_KEYS = Object.keys(PAGE_CONTENT_REGISTRY)

/** Every field definition on a page — hero fields first, then each section's. */
export const allFieldDefs = (pageKey) => {
  const page = PAGE_CONTENT_REGISTRY[pageKey]
  if (!page) return []
  return [...page.hero.fields, ...page.sections.flatMap((s) => s.fields)]
}

/** `{ [fieldKey]: default }` for a page — what the editor shows before any save. */
export const defaultValues = (pageKey) => {
  const out = {}
  for (const field of allFieldDefs(pageKey)) out[field.key] = field.default ?? ''
  return out
}
