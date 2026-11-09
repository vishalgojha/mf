import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { ThemeProvider, Container, CssBaseline, Box, Typography, Link, Button, Paper, Stack } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import KeyIcon from '@mui/icons-material/Key';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useSelector } from 'react-redux';
import { SnackbarProvider } from 'notistack';
import { getTheme } from '../features/theme/themeSlice';
import { lightTheme, darkTheme } from '../theme';
import Header from './Header';

const Layout = () => {
  const theme = useSelector(getTheme);
  const [oneTimeKey, setOneTimeKey] = useState(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState('');

  const getOneTimeKey = async () => {
    setKeyLoading(true);
    setKeyError('');
    try {
      const response = await fetch('/api/instinct/keys', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not issue a key.');
      setOneTimeKey(body);
    } catch (error) {
      setKeyError(error.message);
    } finally {
      setKeyLoading(false);
    }
  };

  const copyKey = async () => {
    if (oneTimeKey?.key) await navigator.clipboard.writeText(oneTimeKey.key);
  };

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
              them, then ranks the covered Direct-Growth funds over exactly those dates.
              Compare each fund with the index, see which categories led, and download the
              NAV data as CSV. Fund NAVs come from the
                <Link href="https://www.mfapi.in/" target="_blank" rel="noopener"> MFAPI.in</Link> free API;
              Nifty 50 closes are bundled from NSE data. Built with React, D3, and Material UI.
            </Typography>
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle1" fontWeight="bold">Try the Instinct API</Typography>
                <Typography variant="body2" color="text.secondary">
                  Get a free bearer key for one hosted-agent request. It expires after 10 minutes and is never stored in your browser.
                </Typography>
                <Box>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<KeyIcon />}
                    onClick={getOneTimeKey}
                    disabled={keyLoading}
                  >
                    {keyLoading ? 'Creating key…' : 'Create one-time key'}
                  </Button>
                </Box>
                {oneTimeKey && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography component="code" sx={{ wordBreak: 'break-all' }}>{oneTimeKey.key}</Typography>
                    <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyKey}>Copy</Button>
                    <Typography variant="caption" color="text.secondary">Use as <code>Authorization: Bearer {oneTimeKey.key}</code> on <code>/api/instinct/ask</code>.</Typography>
                  </Box>
                )}
                {keyError && <Typography variant="body2" color="error">{keyError}</Typography>}
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Container>
    </ThemeProvider>
  );
};

export default Layout;
