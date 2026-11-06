// Rewritten for Unity 6: the ripped file contained only compiled GLES programs, which
// cannot run on D3D11. Reconstructed from that GLES code: albedo = _MainTex * _Color *
// _Detail(second UV set) * 2. Lighting is the regular Lambert model, like every other legacy
// lit shader renders in Unity 6 (the original Unity 4 build doubled the light; the AR app
// applies such a factor globally if needed).
Shader "MyShaders/Diffuse Detail 2 UV sets" {
Properties {
 _Color ("Main Color", Color) = (1,1,1,1)
 _MainTex ("Base (RGB)", 2D) = "white" {}
 _Detail ("Detail (RGB)", 2D) = "gray" {}
}
SubShader {
 Tags { "RenderType"="Opaque" }
 LOD 250

 CGPROGRAM
 #pragma surface surf Lambert

 sampler2D _MainTex;
 sampler2D _Detail;
 fixed4 _Color;

 struct Input {
  float2 uv_MainTex;
  float2 uv2_Detail;
 };

 void surf (Input IN, inout SurfaceOutput o) {
  fixed4 c = tex2D(_MainTex, IN.uv_MainTex) * _Color;
  c.rgb *= tex2D(_Detail, IN.uv2_Detail).rgb * 2.0;
  o.Albedo = c.rgb;
  o.Alpha = c.a;
 }
 ENDCG
}
Fallback "Legacy Shaders/Diffuse"
}
