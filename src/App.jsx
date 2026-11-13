import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ChartWrapper from "./components/ChartWrapper";
import Screener from "./features/screener";

function App() {
  return (
    <>
      <Routes>
        <Route path="/*" element={<Layout />}>
          <Route index element={<ChartWrapper />} />
          <Route path="screener" element={<Screener />} />
          <Route path="*" element={<ChartWrapper />} />
        </Route>
      </Routes>
    </>
  );
};

export default App;
