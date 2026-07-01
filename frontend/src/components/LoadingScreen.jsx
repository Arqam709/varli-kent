import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function LoadingScreen({ onComplete }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const alreadyLoaded = sessionStorage.getItem('vk_loaded');
    //prevent to show load screen on every page reload
    
    if (alreadyLoaded) {
      onComplete?.();
      setVisible(false);
      return;
    }

    const fadeTimer = setTimeout(() => {
      setVisible(false);
    }, 2200);

    const completeTimer = setTimeout(() => {
      sessionStorage.setItem('vk_loaded', '1');
      onComplete?.();
    }, 2700);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="loading-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          style={{ backgroundColor: '#080a0e' }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
        >
          {/* SVG Logo Mark */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="878 395 165 160"
              width="80"
              height="78"
              aria-label="VarliKent logo mark"
            >
              {/* Green polygon 1 */}
              <polygon
                fill="#4b6741"
                points="1039.31 399.66 923.81 551.18 878.29 452.72 904.39 452.72 927.85 504.26 948.1 478.32 948.1 399.66 970.2 399.66 970.2 449.8 1008.98 399.66 1039.31 399.66"
              />
              {/* Green polygon 2 */}
              <polygon
                fill="#4b6741"
                points="1040.2 550.42 1007.39 550.42 970.83 503.26 986.19 483.07 1040.2 550.42"
              />
              {/* Navy polygon */}
              <polygon
                fill="#202a36"
                points="1008.98 399.66 927.85 504.26 904.39 452.72 878.29 452.72 923.81 551.18 1039.31 399.66 1008.98 399.66"
              />
            </svg>
          </motion.div>

          {/* VARLIKENT wordmark */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
            style={{
              fontFamily: "'Cinzel', serif",
              letterSpacing: '0.35em',
              color: '#ffffff',
              fontSize: '1rem',
              marginTop: '1.25rem',
              fontWeight: 400,
            }}
          >
            VARLIKENT
          </motion.p>

          {/* Gold rule */}
          <motion.span
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: 'easeOut', delay: 0.6 }}
            style={{
              display: 'block',
              width: '100px',
              height: '1px',
              backgroundColor: '#c4993a',
              marginTop: '1rem',
              transformOrigin: 'center',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
