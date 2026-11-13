import AppBar from '@mui/material/AppBar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useDispatch, useSelector } from 'react-redux';
import { switchTheme, getTheme } from '../features/theme/themeSlice';
import { useLocation } from 'react-router-dom';
import "@fontsource/exo/700.css";

const Header = () => {
  const dispatch = useDispatch();
  const theme = useSelector(getTheme);
  const location = useLocation();

  const handleThemeChange = () => {
    dispatch(switchTheme());
  };

  return (
    <>
      <AppBar elevation={0} variant="dense" component="nav" sx={{ height: 60, backgroundColor: "background.contrast", zIndex: 9,  color: "#2d2e2e", borderBottom: 2, borderBottomColor: "#ff834f", position: "fixed" }}>
        <Container maxWidth="lg" sx={{ display: "flex", alignItems: "center", height: "100%" }}>
          <Toolbar sx={{ minHeight: "unset", width: "100%" }}>
            <div style={{ display: "inline-flex", height: "100%", alignItems: "center" }}>
              <QueryStatsIcon sx={{ mr: "5px", fontSize: 20, backgroundColor: "#ff834f", color: "white" }} />
              <Typography component="div" variant="h6" fontWeight="bold" fontFamily="Exo" sx={{ color: "text.secondary" }}>
                LevelLens
              </Typography>
            </div>
            <Box sx={{ flexGrow: 1 }}>
              <Link href="/" component="a" sx={{ mx: 2, color: "text.secondary", textDecoration: "none", fontWeight: 500 }}>
                Nifty Range
              </Link>
              <Link href="/screener" component="a" sx={{ mx: 2, color: location.pathname === "/screener" ? "#ff834f" : "text.secondary", textDecoration: "none", fontWeight: 500 }}>
                Screener
              </Link>
            </Box>
            <IconButton aria-label="mode" sx={{ ml: "auto", fontSize: 24, color: "text.secondary" }} onClick={handleThemeChange}>
              {theme === "light" ? <DarkModeIcon /> : <LightModeIcon />}
            </IconButton>
          </Toolbar>
        </Container>
      </AppBar>
    </>
  );
};

export default Header;
