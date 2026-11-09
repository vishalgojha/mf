import { Outlet } from 'react-router-dom';
import { ThemeProvider, Container, CssBaseline, Box, Typography, Link } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import { useSelector } from 'react-redux';
import { SnackbarProvider } from 'notistack';
import { getTheme } from '../features/theme/themeSlice';
import { lightTheme, darkTheme } from '../theme';
import Header from './Header';

const Layout = () => {
  const theme = useSelector(getTheme);

  return (
    <ThemeProvider theme={theme === "light" ? lightTheme : darkTheme}>
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} autoHideDuration={5000} preventDuplicate />
      <Container disableGutters maxWidth={"lg"} sx={{ border: 0, borderColor: "#c7c5c5", px: 0 }}>
        <CssBaseline />
        <Header />
        <Box sx={{ mt: "70px" }}>
          <Outlet />
          <Box sx={{ width: "100%", px: "15px", mt: "20px", alignItems: "center" }}>
            <Link href="https://github.com/vishalgojha/mf" target="_blank" rel="noopener" sx={{ display: "flex", alignItems: "center", my: "10px", width: "fit-content" }}>
              <Typography variant='h4' sx={{ fontFamily: "Exo" }}>LevelLens</Typography>
              <GitHubIcon sx={{ ml: "10px", fontSize: "30px", verticalAlign: "middle" }} />
            </Link>
            <Typography variant='body2' sx={{ color: "text.secondary", textAlign: "justify", pb: "20px" }}>
              A free, open-source way to look at Indian mutual funds. Search any scheme and
              chart its historical NAV, or open Nifty range performance: pick two Nifty 50
              levels, and the app finds the most recent time the index travelled between
              them, then ranks 62 popular Direct-Growth funds over exactly those dates.
              Compare each fund with the index, see which categories led, and download the
              NAV data as CSV. Fund NAVs come from the
                <Link href="https://www.mfapi.in/" target="_blank" rel="noopener"> MFAPI.in</Link> free API;
              Nifty 50 closes are bundled from NSE data. Built with React, D3, and Material UI.
            </Typography>
          </Box>
        </Box>
      </Container>
    </ThemeProvider>
  );
};

export default Layout;
